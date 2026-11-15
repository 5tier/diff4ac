import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type RunningServer } from "../src/server/server";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { createTempHome, type TempHome } from "./helpers/home";

const PROJECT_ROOT = join(import.meta.dir, "..");

async function launchChromium(): Promise<Browser> {
  const attempts: Array<() => Promise<Browser>> = [
    () => chromium.launch({ headless: true }),
    () => chromium.launch({ headless: true, channel: "chrome" }),
    () =>
      chromium.launch({
        headless: true,
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      }),
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `could not launch a Playwright browser; run \`bunx playwright install chromium\`: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

beforeAll(() => {
  if (existsSync(join(PROJECT_ROOT, "dist", "web", "assets", "main.js"))) {
    return;
  }
  const build = Bun.spawnSync({
    cmd: [process.execPath, join(PROJECT_ROOT, "scripts", "build-web.ts")],
    cwd: PROJECT_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) {
    throw new Error(`building the SPA failed: ${build.stderr.toString()}`);
  }
}, 30_000);

async function waitForLayoutStable(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const pane = document.querySelector<HTMLElement>(".diff-pane");
      const ruler = document.querySelector<HTMLElement>(
        '[data-testid="overview-ruler"]',
      );
      if (
        !pane ||
        !ruler
      ) {
        return false;
      }
      const paneRect = pane.getBoundingClientRect();
      const signature = JSON.stringify({
        scrollHeight: pane.scrollHeight,
        marks: Array.from(
          document.querySelectorAll<HTMLElement>(".overview-mark"),
        ).map((mark) => [
          mark.style.top,
          Math.round(mark.getBoundingClientRect().top - paneRect.top),
        ]),
        rows: Array.from(
          document.querySelectorAll<HTMLElement>("[data-layout-rows]"),
        ).map((rows) => [
          rows.dataset.fileKey,
          rows.dataset.rowCount,
          Math.round(rows.getBoundingClientRect().top - paneRect.top),
        ]),
      });
      const state = window as unknown as {
        __layoutSignature?: string;
        __layoutStable?: number;
      };
      if (state.__layoutSignature === signature) {
        state.__layoutStable = (state.__layoutStable ?? 0) + 1;
      } else {
        state.__layoutSignature = signature;
        state.__layoutStable = 0;
      }
      return (state.__layoutStable ?? 0) >= 3;
    },
    undefined,
    { polling: 50, timeout: 5000 },
  );
}

async function waitForScrollSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const pane = document.querySelector<HTMLElement>(".diff-pane");
      if (!pane) {
        return false;
      }
      const state = window as unknown as {
        __scrollTop?: number;
        __scrollStable?: number;
      };
      if (state.__scrollTop === pane.scrollTop) {
        state.__scrollStable = (state.__scrollStable ?? 0) + 1;
      } else {
        state.__scrollTop = pane.scrollTop;
        state.__scrollStable = 0;
      }
      return (state.__scrollStable ?? 0) >= 3;
    },
    undefined,
    { polling: 50, timeout: 5000 },
  );
}

async function settleImagesAndLayout(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const image of Array.from(document.images)) {
      image.loading = "eager";
    }
  });
  await page
    .waitForFunction(
      () => Array.from(document.images).every((image) => image.complete),
      undefined,
      { polling: 50, timeout: 5000 },
    )
    .catch(() => {});
  await waitForLayoutStable(page);
}

async function clickEveryMark(page: Page): Promise<void> {
  const count = await page.locator(".overview-mark").count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index++) {
    const mark = await page.evaluate((markIndex) => {
      const element = document.querySelectorAll<HTMLElement>(
        ".overview-mark",
      )[markIndex];
      return {
        fileKey: element?.dataset.fileKey ?? "",
        row: Number(element?.dataset.row ?? -1),
      };
    }, index);
    expect(mark.fileKey).not.toBe("");
    expect(mark.row).toBeGreaterThanOrEqual(0);

    await waitForLayoutStable(page);
    await page
      .locator(".overview-mark")
      .nth(index)
      .dispatchEvent("pointerdown");
    await waitForScrollSettled(page);
    await page.waitForFunction(
      ({ fileKey, row }) => {
        const pane = document.querySelector<HTMLElement>(".diff-pane");
        if (!pane) {
          return false;
        }
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-layout-rows]"),
        ).find((element) => element.dataset.fileKey === fileKey);
        const rowElement = rows?.querySelector<HTMLElement>(
          `[data-diff-row="${row}"]`,
        );
        if (!rows || !rowElement) {
          return false;
        }
        const sticky = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".diff-heading, .commit-stack-heading",
          ),
        ).reduce((max, heading) => Math.max(max, heading.offsetHeight), 0);
        const top =
          rowElement.getBoundingClientRect().top -
          pane.getBoundingClientRect().top;
        const rowHeight = Number(rows.dataset.rowHeight);
        return top >= sticky - 1 && top <= sticky + rowHeight + 1;
      },
      mark,
      { polling: 50, timeout: 5000 },
    );
  }
}

async function jumpEveryHunk(page: Page): Promise<void> {
  await page.keyboard.press("0");
  await page.locator(".diff-pane").evaluate((element) => {
    element.scrollTo({ top: 0 });
  });
  await waitForScrollSettled(page);

  const anchors = await page.evaluate(() => {
    const keys: string[] = [];
    for (const rows of Array.from(
      document.querySelectorAll<HTMLElement>("[data-layout-rows]"),
    )) {
      let firstBlock = true;
      let inChange = false;
      for (const row of Array.from(
        rows.querySelectorAll<HTMLElement>("[data-diff-row]"),
      )) {
        const key = `${rows.dataset.fileKey ?? ""}:${row.dataset.diffRow ?? ""}`;
        if (row.classList.contains("diff-hunk")) {
          keys.push(key);
          firstBlock = true;
          inChange = false;
          continue;
        }
        const changed =
          row.classList.contains("diff-add") ||
          row.classList.contains("diff-delete") ||
          row.querySelector(
            ".diff-add, .diff-delete, .diff-split-add, .diff-split-delete",
          ) !== null;
        if (changed && !inChange) {
          if (!firstBlock) {
            keys.push(key);
          }
          firstBlock = false;
        }
        inChange = changed;
      }
    }
    return keys;
  });
  expect(anchors.length).toBeGreaterThan(0);

  const initial = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".diff-pane");
    if (!pane) {
      return "";
    }
    const sticky = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".diff-heading, .commit-stack-heading",
      ),
    ).reduce((max, heading) => Math.max(max, heading.offsetHeight), 0);
    const paneRect = pane.getBoundingClientRect();
    const row = Array.from(
      document.querySelectorAll<HTMLElement>("[data-diff-row]"),
    ).find((element) => {
      const top = element.getBoundingClientRect().top - paneRect.top;
      return top >= sticky - 1 && top <= sticky + 20;
    });
    const rows = row?.closest<HTMLElement>("[data-layout-rows]");
    return `${rows?.dataset.fileKey ?? ""}:${row?.dataset.diffRow ?? ""}`;
  });
  const expected = anchors[0] === initial ? anchors.slice(1) : anchors;
  expect(expected.length).toBeGreaterThan(0);

  const visited: string[] = [];

  for (let index = 0; index < expected.length; index++) {
    const key = expected[index] as string;
    await page.keyboard.press("]");
    await page
      .waitForFunction(
        (targetKey) => {
          const pane = document.querySelector<HTMLElement>(".diff-pane");
          if (!pane) {
            return false;
          }
          const split = targetKey.lastIndexOf(":");
          const fileKey = targetKey.slice(0, split);
          const row = Number(targetKey.slice(split + 1));
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-layout-rows]"),
          ).find((element) => element.dataset.fileKey === fileKey);
          const rowElement = rows?.querySelector<HTMLElement>(
            `[data-diff-row="${row}"]`,
          );
          if (!rows || !rowElement) {
            return false;
          }
          const paneRect = pane.getBoundingClientRect();
          const sticky = Array.from(
            document.querySelectorAll<HTMLElement>(
              ".diff-heading, .commit-stack-heading",
            ),
          ).reduce((max, heading) => Math.max(max, heading.offsetHeight), 0);
          const rowRect = rowElement.getBoundingClientRect();
          const rowHeight = Number(rows.dataset.rowHeight);
          const topRow = Array.from(
            document.querySelectorAll<HTMLElement>("[data-diff-row]"),
          ).find((element) => {
            const top = element.getBoundingClientRect().top - paneRect.top;
            return top >= sticky - 1 && top <= sticky + rowHeight + 1;
          });
          const topRows = topRow?.closest<HTMLElement>("[data-layout-rows]");
          const topKey = `${topRows?.dataset.fileKey ?? ""}:${
            topRow?.dataset.diffRow ?? ""
          }`;
          if (
            topKey === targetKey &&
            rowRect.top - paneRect.top >= sticky - 1 &&
            rowRect.top - paneRect.top <= sticky + rowHeight + 1
          ) {
            return "sticky";
          }
          const atMax =
            pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 1;
          if (
            atMax &&
            rowRect.bottom > paneRect.top &&
            rowRect.top < paneRect.bottom
          ) {
            return "visible";
          }
          return false;
        },
        key,
        { polling: 50, timeout: 5000 },
      )
      .then(async () => {
        await waitForScrollSettled(page);
      });

    const placement = await page.evaluate((targetKey) => {
      const pane = document.querySelector<HTMLElement>(".diff-pane");
      if (!pane) {
        return "missing";
      }
      const split = targetKey.lastIndexOf(":");
      const fileKey = targetKey.slice(0, split);
      const row = Number(targetKey.slice(split + 1));
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-layout-rows]"),
      ).find((element) => element.dataset.fileKey === fileKey);
      const rowElement = rows?.querySelector<HTMLElement>(
        `[data-diff-row="${row}"]`,
      );
      if (!rows || !rowElement) {
        return "missing";
      }
      const paneRect = pane.getBoundingClientRect();
      const sticky = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".diff-heading, .commit-stack-heading",
        ),
      ).reduce((max, heading) => Math.max(max, heading.offsetHeight), 0);
      const rowRect = rowElement.getBoundingClientRect();
      const rowHeight = Number(rows.dataset.rowHeight);
      if (
        rowRect.top - paneRect.top >= sticky - 1 &&
        rowRect.top - paneRect.top <= sticky + rowHeight + 1
      ) {
        return "sticky";
      }
      const atMax =
        pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 1;
      return atMax &&
        rowRect.bottom > paneRect.top &&
        rowRect.top < paneRect.bottom
        ? "visible"
        : "missed";
    }, key);

    if (placement === "sticky") {
      visited.push(key);
      continue;
    }
    if (placement !== "visible") {
      throw new Error(`] missed hunk ${key}: ${placement}`);
    }

    // At maximum scroll the remaining hunk rows cannot reach the sticky
    // header. They must all at least be visible in the viewport.
    const remaining = expected.slice(index);
    await page.waitForFunction(
      (keys) => {
        const pane = document.querySelector<HTMLElement>(".diff-pane");
        if (!pane) {
          return false;
        }
        const paneRect = pane.getBoundingClientRect();
        return keys.every((targetKey) => {
          const split = targetKey.lastIndexOf(":");
          const fileKey = targetKey.slice(0, split);
          const row = Number(targetKey.slice(split + 1));
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-layout-rows]"),
          ).find((element) => element.dataset.fileKey === fileKey);
          const rowElement = rows?.querySelector<HTMLElement>(
            `[data-diff-row="${row}"]`,
          );
          if (!rowElement) {
            return false;
          }
          const rect = rowElement.getBoundingClientRect();
          return rect.bottom > paneRect.top && rect.top < paneRect.bottom;
        });
      },
      remaining,
      { polling: 50, timeout: 5000 },
    );
    visited.push(...remaining);
    break;
  }

  expect(visited).toEqual(expected);
}

async function jumpEveryFile(page: Page): Promise<void> {
  const files = await page.evaluate(() => {
    const views = Array.from(
      document.querySelectorAll<HTMLElement>(".diff-view"),
    ).map((view) => view.dataset.fileKey ?? "");
    if (views.length > 1) {
      return views;
    }
    return Array.from(
      document.querySelectorAll<HTMLElement>(".file-row .file-path"),
    )
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);
  });
  expect(files.length).toBeGreaterThan(1);

  const placement = (key: string) =>
    page.evaluate((fileKey) => {
      const pane = document.querySelector<HTMLElement>(".diff-pane");
      if (!pane) {
        return "missing";
      }
      const view = Array.from(
        document.querySelectorAll<HTMLElement>(".diff-view"),
      ).find((element) => element.dataset.fileKey === fileKey);
      if (!view) {
        return "missing";
      }
      const paneRect = pane.getBoundingClientRect();
      const sticky = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".diff-heading, .commit-stack-heading",
        ),
      ).reduce((max, heading) => Math.max(max, heading.offsetHeight), 0);
      const rows = view.querySelector<HTMLElement>("[data-layout-rows]");
      const rowHeight = rows ? Number(rows.dataset.rowHeight) : 0;
      const row = rows?.querySelector<HTMLElement>('[data-diff-row="0"]');
      if (row) {
        const top = row.getBoundingClientRect().top - paneRect.top;
        if (top >= sticky - 1 && top <= sticky + rowHeight + 1) {
          return "sticky";
        }
      } else {
        const heading = view.querySelector<HTMLElement>(".diff-heading");
        const top = heading?.getBoundingClientRect().top ?? -100;
        if (top - paneRect.top >= -1 && top - paneRect.top <= sticky + 1) {
          return "sticky";
        }
      }
      const atMax =
        pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 1;
      const rect = view.getBoundingClientRect();
      return atMax && rect.bottom > paneRect.top && rect.top < paneRect.bottom
        ? "visible"
        : "missed";
    }, key);

  await page.locator(".file-row").first().click();
  await waitForLayoutStable(page);
  await page.keyboard.press("0");
  const first = await placement(files[0] as string);
  expect(first === "sticky" || first === "visible").toBe(true);

  const visited: string[] = [];

  for (let index = 0; index < files.length; index++) {
    const key = files[index] as string;
    if (index > 0) {
      await page.keyboard.press("}");
      await page
        .waitForFunction(
          (targetKey) => {
            const pane = document.querySelector<HTMLElement>(".diff-pane");
            if (!pane) {
              return false;
            }
            const view = Array.from(
              document.querySelectorAll<HTMLElement>(".diff-view"),
            ).find((element) => element.dataset.fileKey === targetKey);
            if (!view) {
              return false;
            }
            const paneRect = pane.getBoundingClientRect();
            const sticky = Array.from(
              document.querySelectorAll<HTMLElement>(
                ".diff-heading, .commit-stack-heading",
              ),
            ).reduce(
              (max, heading) => Math.max(max, heading.offsetHeight),
              0,
            );
            const rows = view.querySelector<HTMLElement>(
              "[data-layout-rows]",
            );
            const rowHeight = rows ? Number(rows.dataset.rowHeight) : 0;
            const row = rows?.querySelector<HTMLElement>(
              '[data-diff-row="0"]',
            );
            if (row) {
              const top = row.getBoundingClientRect().top - paneRect.top;
              if (top >= sticky - 1 && top <= sticky + rowHeight + 1) {
                return "sticky";
              }
            } else {
              const heading = view.querySelector<HTMLElement>(
                ".diff-heading",
              );
              const top = heading?.getBoundingClientRect().top ?? -100;
              if (top - paneRect.top >= -1 && top - paneRect.top <= sticky + 1) {
                return "sticky";
              }
            }
            const atMax =
              pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 1;
            const rect = view.getBoundingClientRect();
            return atMax &&
              rect.bottom > paneRect.top &&
              rect.top < paneRect.bottom
              ? "visible"
              : false;
          },
          key,
          { polling: 50, timeout: 5000 },
        )
        .then(async () => {
          await waitForScrollSettled(page);
        });
    }

    const result = await placement(key);
    if (result === "sticky") {
      visited.push(key);
      continue;
    }
    if (result !== "visible" || index === 0) {
      throw new Error(`} missed file ${key}: ${result}`);
    }

    // At maximum scroll the remaining files cannot reach the sticky header.
    const remaining = files.slice(index);
    await page.waitForFunction(
      (keys) => {
        const pane = document.querySelector<HTMLElement>(".diff-pane");
        if (!pane) {
          return false;
        }
        const paneRect = pane.getBoundingClientRect();
        return keys.every((targetKey) => {
          const view = Array.from(
            document.querySelectorAll<HTMLElement>(".diff-view"),
          ).find((element) => element.dataset.fileKey === targetKey);
          if (!view) {
            return false;
          }
          const rect = view.getBoundingClientRect();
          return rect.bottom > paneRect.top && rect.top < paneRect.bottom;
        });
      },
      remaining,
      { polling: 50, timeout: 5000 },
    );
    visited.push(...remaining);
    break;
  }

  expect(visited).toEqual(files);
}

async function setViewMode(page: Page, mode: "unified" | "side-by-side") {
  const current = await page
    .locator('[data-testid="status-view"]')
    .textContent();
  if (!current?.includes(mode)) {
    await page.keyboard.press("s");
    await page.waitForFunction(
      (target) =>
        document
          .querySelector('[data-testid="status-view"]')
          ?.textContent?.includes(target) ?? false,
      mode,
    );
  }
  await settleImagesAndLayout(page);
}

test(
  "measures ruler marks and jumps from the rendered layout",
  async () => {
    let repo: FixtureRepo | null = null;
    let home: TempHome | null = null;
    let stateDir: string | null = null;
    let server: RunningServer | null = null;
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      repo = createFixtureRepo();
      const oldPng = Buffer.from([0, 1, 2, 3]);
      const newPng = Buffer.from([0, 1, 2, 3, 4]);
      const aBase = Array.from({ length: 88 }, (_, i) => `alpha ${i + 1}`);
      const zBase = Array.from({ length: 10 }, (_, i) => `zulu ${i + 1}`);

      repo.write("assets/logo.png", oldPng);
      repo.write("src/a.ts", `${aBase.join("\n")}\n`);
      repo.write("src/b.ts", "b one\n");
      repo.write("src/z.ts", `${zBase.join("\n")}\n`);
      repo.write(
        "src/zzzz.ts",
        `${Array.from({ length: 50 }, (_, i) => `tail ${i + 1}`).join("\n")}\n`,
      );
      repo.commit("layout base");

      const aChanged = aBase.map((line, index) =>
        index === 9 || index === 49 ? `${line} changed` : line,
      );
      const zChanged = zBase.map((line, index) =>
        index === 4 || index === 7 ? `${line} changed` : line,
      );
      repo.write("assets/logo.png", newPng);
      repo.write("src/a.ts", `${aChanged.join("\n")}\n`);
      repo.write("src/z.ts", `${zChanged.join("\n")}\n`);
      repo.write(
        "src/large.ts",
        `${Array.from({ length: 1600 }, (_, i) => `large ${i + 1}`).join("\n")}\n`,
      );
      repo.commit("layout changes");

      repo.write("src/b.ts", "b two\n");
      repo.write(
        "src/c.ts",
        `${Array.from({ length: 50 }, (_, i) => `trailing ${i + 1}`).join("\n")}\n`,
      );
      repo.commit("third layout commit");

      repo.write("assets/logo.png", Buffer.from([9, 9, 9]));
      repo.commit("image tail commit");

      stateDir = mkdtempSync(join(tmpdir(), "diff4ac-layout-state-"));
      home = createTempHome();
      server = await startServer({
        repoPath: repo.root,
        stateDir,
        homeDir: home.path,
      });
      browser = await launchChromium();
      page = await browser.newPage({
        viewport: { width: 1200, height: 800 },
      });
      await page.goto(server.url);
      await page.waitForSelector(".commit-row");

      await page.locator(".commit-row", { hasText: "layout changes" }).click();
      await page.waitForSelector(".file-row");
      await page.locator(".file-row", { hasText: "src/a.ts" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/a.ts"),
      );
      await settleImagesAndLayout(page);

      for (const mode of ["side-by-side", "unified"] as const) {
        await page.locator(".file-row", { hasText: "src/a.ts" }).click();
        await page.waitForFunction(() =>
          document
            .querySelector(".diff-heading-path")
            ?.textContent?.includes("src/a.ts"),
        );
        await setViewMode(page, mode);
        await clickEveryMark(page);
        await jumpEveryHunk(page);
        await jumpEveryFile(page);
      }

      await page.reload();
      await page.waitForSelector(".commit-row");
      await page.keyboard.press("3");
      await page.keyboard.press("Space");
      await page.keyboard.press("j");
      await page.keyboard.press("Space");
      await page.keyboard.press("j");
      await page.keyboard.press("Space");
      await page.keyboard.press("t");
      await page.waitForFunction(
        () => document.querySelectorAll(".commit-stack-group").length === 3,
      );
      await settleImagesAndLayout(page);

      for (const mode of ["side-by-side", "unified"] as const) {
        await setViewMode(page, mode);
        await clickEveryMark(page);
        await jumpEveryHunk(page);
        await jumpEveryFile(page);
      }
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Already closed.
        }
      }
      if (browser) {
        try {
          await browser.close();
        } catch {
          // Already closed.
        }
      }
      if (server) {
        try {
          server.stop();
        } catch {
          // Already stopped.
        }
      }
      if (repo) {
        try {
          repo.dispose();
        } catch {
          // Best effort.
        }
      }
      if (home) {
        try {
          home.dispose();
        } catch {
          // Best effort.
        }
      }
      if (stateDir) {
        try {
          rmSync(stateDir, { recursive: true, force: true });
        } catch {
          // Best effort.
        }
      }
    }
  },
  120_000,
);
