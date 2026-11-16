import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import type { RunningServer } from "../src/server/server";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { startFixtureServer } from "./helpers/server";
import {
  ensureSpaBuilt,
  launchChromium,
  startBrowserSession,
} from "./helpers/browser";


function lines(count: number): string {
  return `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
}

function codeViewFixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repo.write("src/alpha.ts", lines(80));
  repo.write(
    "src/highlight.ts",
    'export const answer: number = 42;\nconst label = "hello"; // comment\n',
  );
  repo.write("src/deep/unchanged.ts", "deep unchanged\n");
  repo.write("src/nested/changed.ts", "one\ntwo\nthree\n");
  repo.write("docs/deleted.txt", "deleted\n");
  repo.commit("first commit");

  const alpha = lines(80).replace("line 5\n", "line 5 changed\n");
  repo.write("src/alpha.ts", alpha);
  repo.write("src/nested/changed.ts", "one\ntwo\nthree changed\n");
  repo.remove("docs/deleted.txt");
  repo.commit("second commit");

  repo.write("src/untracked.ts", "new file\n");
  return repo;
}

let repo: FixtureRepo;
let running: RunningServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  await ensureSpaBuilt();
  repo = codeViewFixture();
  running = (await startFixtureServer({ repo })).running;
  browser = await launchChromium();
}, 120_000);

afterEach(async () => {
  await page?.close().catch(() => {});
}, 60_000);

async function openPage(): Promise<Page> {
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(60_000);
  await page.goto(running.url);
  await page.waitForSelector(".commit-row");
  return page;
}

async function selectCommit(target: Page, message: string): Promise<void> {
  await target.keyboard.press("3");
  await target.locator(".commit-row", { hasText: message }).click();
  await target.waitForFunction(() =>
    document.querySelector(".top-bar-mode")?.textContent?.startsWith("Commit"),
  );
  // The previous selection's rows can still be in the list while the commit
  // Change Set loads, so wait for a file this commit is known to contain.
  await target
    .locator(".file-row", { hasText: "src/alpha.ts" })
    .waitFor();
}

async function openFromReview(target: Page, path: string): Promise<void> {
  await target.locator(".file-row", { hasText: path }).click();
  await target.waitForFunction(
    (expected) =>
      document
        .querySelector(".diff-heading-path")
        ?.textContent?.includes(expected),
    path,
  );
  await target.keyboard.press("o");
  await target.waitForSelector('[data-testid="code-view"]');
  await target.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes(expected),
    path,
  );
}

async function expandFolder(target: Page, dir: string): Promise<void> {
  const folder = target.locator(`[data-folder-path="${dir}"]`);
  await folder.waitFor();
  if ((await folder.getAttribute("aria-expanded")) !== "true") {
    await folder.click();
  }
  await target.waitForFunction(
    (prefix) =>
      document.querySelectorAll(".code-tree-file").length > 0 &&
      Array.from(document.querySelectorAll(".code-tree-file")).some((row) =>
        row.getAttribute("data-path")?.startsWith(`${prefix}/`),
      ),
    dir,
  );
}

async function openViaFinder(
  target: Page,
  query: string,
  path: string,
): Promise<void> {
  await target.keyboard.press("Control+p");
  const finder = target.locator('[data-testid="code-finder"]');
  await finder.waitFor();
  await finder.locator("input").fill(query);
  await finder.locator(".code-finder-row").first().waitFor();
  await target.keyboard.press("Enter");
  await target.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes(expected),
    path,
  );
}

async function waitForSyntaxColours(target: Page): Promise<string[]> {
  const read = () => {
    const heading = document.querySelector(
      '[data-testid="code-heading"] .diff-heading-path',
    )?.textContent;
    const rows = Array.from(
      document.querySelectorAll("[data-layout-rows]"),
    ).find((element) => element.getAttribute("data-file-key") === heading);
    const spans = rows ? Array.from(rows.querySelectorAll(".syntax-token")) : [];
    return spans.map((span) => getComputedStyle(span).color);
  };

  await target.waitForFunction(() => {
    const heading = document.querySelector(
      '[data-testid="code-heading"] .diff-heading-path',
    )?.textContent;
    const rows = Array.from(
      document.querySelectorAll("[data-layout-rows]"),
    ).find((element) => element.getAttribute("data-file-key") === heading);
    const spans = rows ? Array.from(rows.querySelectorAll(".syntax-token")) : [];
    const colours = new Set(
      spans.map((span) => getComputedStyle(span).color),
    );
    return colours.size > 1;
  });
  return target.evaluate(read);
}

describe("Code View", () => {
  test("opens the selected diff file with margin marks and before/after content", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");

    await session.waitForFunction(
      () =>
        document.querySelectorAll(".code-line-added, .code-line-modified")
          .length > 0,
    );
    expect(
      await session.locator(".code-line-added, .code-line-modified").count(),
    ).toBeGreaterThan(0);

    await session.keyboard.press("b");
    await session.waitForFunction(
      () =>
        Array.from(document.querySelectorAll(".code-line")).some((line) =>
          line.textContent?.includes("line 5"),
        ) &&
        !Array.from(document.querySelectorAll(".code-line")).some((line) =>
          line.textContent?.includes("line 5 changed"),
        ),
    );
    expect(
      await session.locator('[data-testid="code-view-status"]').textContent(),
    ).toContain("before");

    await session.keyboard.press("b");
    await session.waitForFunction(() =>
      Array.from(document.querySelectorAll(".code-line")).some((line) =>
        line.textContent?.includes("line 5 changed"),
      ),
    );
  }, 60_000);

  test("opens at the top new-side line of the reviewed diff", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await session.locator(".file-row", { hasText: "src/alpha.ts" }).click();
    await session.keyboard.press("0");
    await session.waitForFunction(
      () =>
        document
          .querySelector('[data-panel="diff"]')
          ?.getAttribute("data-focused") === "true",
    );
    await session.waitForFunction(() =>
      Array.from(
        document.querySelectorAll(".diff-content, .diff-line"),
      ).some((line) => line.textContent?.trim() === "line 80"),
    );
    await session
      .locator(".diff-pane")
      .evaluate((element) => element.scrollTo({ top: 200 }));
    await session.waitForFunction(
      () => (document.querySelector(".diff-pane")?.scrollTop ?? 0) > 0,
    );

    await session.keyboard.press("o");
    await session.waitForSelector('[data-testid="code-view"]');
    await session.waitForFunction(
      () => (document.querySelector(".code-pane")?.scrollTop ?? 0) > 0,
    );
  }, 60_000);

  test("moves between changed files across folders with } and {", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");

    await session.keyboard.press("}");
    await session.waitForFunction(() =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes("src/nested/changed.ts"),
    );
    await session.keyboard.press("{");
    await session.waitForFunction(() =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes("src/alpha.ts"),
    );
  }, 60_000);

  test("finds an unchanged deep file with Ctrl+P", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");

    await session.keyboard.press("Control+p");
    const finder = session.locator('[data-testid="code-finder"]');
    await finder.waitFor();
    await finder.locator("input").fill("unchanged");
    await finder.locator(".code-finder-row").first().waitFor();
    await session.keyboard.press("Enter");
    await session.waitForFunction(() =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes("src/deep/unchanged.ts"),
    );
  }, 60_000);

  test("shows a deleted file greyed in the tree", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");
    await expandFolder(session, "docs");

    const row = session.locator('[data-path="docs/deleted.txt"]');
    await row.waitFor();
    expect(await row.getAttribute("data-status")).toBe("deleted");
    expect(await row.getAttribute("class")).toContain("code-tree-deleted");
  }, 60_000);

  test("marks the open changed file and keeps the mark in the review layout", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");

    await session.keyboard.press("m");
    await session.waitForFunction(() =>
      document.querySelector(".code-mark-button")?.textContent?.includes("Unmark"),
    );
    await session.keyboard.press("o");
    await session.waitForSelector(".file-row-reviewed");
    expect(await session.locator(".file-row-reviewed").count()).toBe(1);
  }, 60_000);

  test("shows untracked Pending files in the Snapshot tree", async () => {
    const session = await openPage();
    await session.keyboard.press("o");
    await session.waitForSelector('[data-testid="code-view"]');
    await expandFolder(session, "src");

    const row = session.locator('[data-path="src/untracked.ts"]');
    await row.waitFor();
    expect(await row.getAttribute("data-status")).toBe("added");
  }, 60_000);

  test("remembers the open file and expanded folders when toggling back", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");
    await expandFolder(session, "docs");
    await session.locator('[data-path="docs/deleted.txt"]').click();
    await session.waitForFunction(() =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes("docs/deleted.txt"),
    );

    await session.keyboard.press("o");
    await session.waitForSelector(".diff-heading-path");
    await session.keyboard.press("o");
    await session.waitForSelector('[data-testid="code-view"]');
    await session.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="code-heading"]')
          ?.textContent?.includes("docs/deleted.txt") ?? false,
    );
    expect(
      await session
        .locator('[data-folder-path="docs"]')
        .getAttribute("aria-expanded"),
    ).toBe("true");
  }, 60_000);

  test("colours syntax tokens in light and dark themes", async () => {
    const session = await openPage();
    for (const theme of ["light", "dark"] as const) {
      await session.evaluate((value) => {
        localStorage.setItem("diff4ac-theme", value);
        // Code View remembers its open file per Snapshot in sessionStorage.
        sessionStorage.clear();
      }, theme);
      await session.reload();
      await session.waitForSelector(".commit-row");
      await selectCommit(session, "second commit");
      await openFromReview(session, "src/alpha.ts");
      await openViaFinder(session, "src/highlight.ts", "src/highlight.ts");

      const colours = await waitForSyntaxColours(session);
      expect(colours.length).toBeGreaterThan(1);
    }
  }, 60_000);

  test("keeps token colours and search marks while searching", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await openFromReview(session, "src/alpha.ts");
    await openViaFinder(session, "src/highlight.ts", "src/highlight.ts");
    await waitForSyntaxColours(session);

    await session.keyboard.press("/");
    const input = session.locator(".code-search-bar input");
    await input.waitFor();
    await input.fill("const");
    await session.waitForFunction(
      () =>
        document.querySelectorAll(".syntax-token.diff-search-match").length > 0,
    );

    const colours = await session.evaluate(() => [
      ...new Set(
        Array.from(document.querySelectorAll(".syntax-token")).map(
          (span) => getComputedStyle(span).color,
        ),
      ),
    ]);
    expect(colours.length).toBeGreaterThan(1);
    expect(
      await session.locator(".syntax-token.diff-search-current").count(),
    ).toBeGreaterThan(0);
  }, 60_000);

  test("never asks for the missing before side of an added file", async () => {
    const repo = createFixtureRepo();
    repo.write("src/seed.ts", "seed\n");
    repo.commit("seed");
    repo.write("src/added.ts", "export const added = 1;\n");
    repo.commit("add file");
    const session = await startBrowserSession(repo, {
      waitForSelector: ".commit-row",
    });
    session.page.setDefaultTimeout(60_000);

    const errors: string[] = [];
    const beforeRequests: string[] = [];
    session.page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await session.page.keyboard.press("3");
    await session.page
      .locator(".commit-row", { hasText: "add file" })
      .click();
    await session.page.waitForFunction(() =>
      document
        .querySelector(".top-bar-mode")
        ?.textContent?.startsWith("Commit"),
    );
    const added = session.page.locator(".file-row", { hasText: "src/added.ts" });
    await added.waitFor();
    await added.click();
    await session.page.keyboard.press("o");
    await session.page.waitForSelector('[data-testid="code-view"]');
    await session.page.waitForFunction(() =>
      document
        .querySelector('[data-testid="code-heading"]')
        ?.textContent?.includes("src/added.ts"),
    );

    session.page.on("request", (request) => {
      if (
        request.url().includes("/api/snapshot/file") &&
        request.url().includes("side=before")
      ) {
        beforeRequests.push(request.url());
      }
    });
    await session.page.keyboard.press("b");
    await session.page.waitForFunction(
      () => document.querySelector('[data-testid="code-heading"]') === null,
    );

    expect(errors).toEqual([]);
    expect(beforeRequests).toEqual([]);
  }, 60_000);

  test("ignores a stale Pending failure after selecting a commit", async () => {
    const session = await openPage();
    await session.addInitScript(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = ((
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.includes("/api/pending")) {
          return original(input, init);
        }
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"selection":'));
            init?.signal?.addEventListener(
              "abort",
              () => {
                try {
                  controller.error(new DOMException("Aborted", "AbortError"));
                } catch {
                  // The browser may already have cancelled the stream.
                }
              },
              { once: true },
            );
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;
    });
    await session.reload();
    await session.waitForSelector(".commit-row");

    await session.keyboard.press("3");
    await session.locator(".commit-row", { hasText: "second commit" }).click();
    await session.waitForFunction(() =>
      document.querySelector(".top-bar-mode")?.textContent?.startsWith("Commit"),
    );
    await session.waitForFunction(
      () => document.querySelectorAll(".file-row").length > 0,
      null,
      { timeout: 10_000 },
    );

    expect(
      await session.locator(".error").filter({ hasText: "not valid JSON" }).count(),
    ).toBe(0);
    expect(
      await session.locator(".file-row", { hasText: "src/alpha.ts" }).count(),
    ).toBeGreaterThan(0);
  }, 60_000);

  test("returns to the review layout unchanged with o", async () => {
    const session = await openPage();
    await selectCommit(session, "second commit");
    await session.locator(".file-row", { hasText: "src/alpha.ts" }).click();
    const heading = await session.locator(".diff-heading-path").textContent();
    const rowsBefore = await session.locator(".diff-line").count();

    await session.keyboard.press("o");
    await session.waitForSelector('[data-testid="code-view"]');
    await session.keyboard.press("o");
    await session.waitForSelector(".diff-heading-path");

    expect(await session.locator(".diff-heading-path").textContent()).toBe(
      heading,
    );
    expect(await session.locator(".diff-line").count()).toBe(rowsBefore);
  }, 60_000);
});
