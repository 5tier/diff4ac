import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type RunningServer } from "../src/server/server";
import {
  createFixtureRepo,
  type FixtureCheckout,
  type FixtureRepo,
} from "./helpers/fixture";

const PROJECT_ROOT = join(import.meta.dir, "..");

let repo: FixtureRepo;
let linkedWorktree: FixtureCheckout;
let running: RunningServer;
let browser: Browser;
let page: Page;

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

async function focusedPanel(): Promise<string | null> {
  return page
    .locator('[data-panel][data-focused="true"]')
    .getAttribute("data-panel");
}

beforeAll(async () => {
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

  repo = createFixtureRepo();
  const longFile = `${Array.from({ length: 220 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;

  repo.write("src/alpha.ts", longFile);
  repo.write("src/beta.ts", "beta one\n");
  repo.commit("first commit");

  repo.write("src/alpha.ts", `${longFile}changed once\n`);
  repo.write("src/beta.ts", "beta two\n");
  repo.commit("second commit");

  repo.write("src/alpha.ts", `${longFile}changed again\n`);
  repo.write("src/gamma.ts", "pending gamma\n");

  linkedWorktree = repo.addWorktree("agent", { branch: "agent-work" });
  linkedWorktree.write("src/linked.ts", "linked pending\n");

  running = await startServer({ repoPath: repo.root });
  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(running.url);
  await page.waitForSelector(".file-row");
}, 30_000);

afterAll(async () => {
  await browser?.close();
  running?.stop();
  repo?.dispose();
});

test(
  "shows Worktree Pending counts independently of the current Selection",
  async () => {
    const slowPage = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await slowPage.route("**/api/pending*", async (route) => {
      await gate;
      await route.continue();
    });

    try {
      await slowPage.goto(running.url);
      await slowPage.waitForSelector(".worktree-row");

      const worktreeText = (
        await slowPage.locator(".worktree-row").allTextContents()
      ).join("\n");
      expect(worktreeText).toContain("2 pending");
      expect(worktreeText).toContain("1 pending");
      expect(await slowPage.locator(".file-row").count()).toBe(0);
      expect(
        await slowPage.locator('[data-panel="files"]').textContent(),
      ).toContain("Loading Change Set");

      release();
      await slowPage.waitForSelector(".file-row");
    } finally {
      release();
      await slowPage.close();
    }
  },
  30_000,
);

test(
  "navigates panels, lists, diff and help with the keyboard",
  async () => {
    expect(await focusedPanel()).toBe("files");
    expect(await page.locator(".file-row-cursor .file-path").textContent()).toContain(
      "src/alpha.ts",
    );

    const worktreeRows = page.locator(".worktree-row");
    expect(await worktreeRows.count()).toBe(2);
    const worktreeText = (await worktreeRows.allTextContents()).join("\n");
    expect(worktreeText).toContain(repo.root);
    expect(worktreeText).toContain(linkedWorktree.root);
    expect(worktreeText).toContain("agent-work");
    expect(worktreeText).toContain("2 pending");
    expect(worktreeText).toContain("1 pending");

    await page.keyboard.press("1");
    expect(await focusedPanel()).toBe("worktrees");
    await page.keyboard.press("j");
    expect(
      await page.locator(".worktree-row-cursor .worktree-path").textContent(),
    ).toBe(linkedWorktree.root);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (linkedPath) =>
        document.querySelector(".top-bar-path")?.textContent === linkedPath &&
        document.querySelectorAll(".file-row").length === 1,
      linkedWorktree.root,
    );
    expect(await page.locator(".file-row .file-path").textContent()).toContain(
      "src/linked.ts",
    );

    await page.keyboard.press("k");
    expect(
      await page.locator(".worktree-row-cursor .worktree-path").textContent(),
    ).toBe(repo.root);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (mainPath) =>
        document.querySelector(".top-bar-path")?.textContent === mainPath &&
        document.querySelectorAll(".file-row").length === 2,
      repo.root,
    );

    await page.keyboard.press("4");
    expect(await focusedPanel()).toBe("files");
    await page.keyboard.press("j");
    expect(await page.locator(".file-row-cursor .file-path").textContent()).toContain(
      "src/gamma.ts",
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".diff-heading-path")
        ?.textContent?.includes("src/gamma.ts"),
    );

    await page.keyboard.press("1");
    expect(await focusedPanel()).toBe("worktrees");
    await page.keyboard.press("2");
    expect(await focusedPanel()).toBe("branches");
    await page.keyboard.press("3");
    expect(await focusedPanel()).toBe("commits");
    await page.keyboard.press("4");
    expect(await focusedPanel()).toBe("files");
    await page.keyboard.press("0");
    expect(await focusedPanel()).toBe("diff");
    await page.keyboard.press("Tab");
    expect(await focusedPanel()).toBe("worktrees");
    await page.keyboard.press("Tab");
    expect(await focusedPanel()).toBe("branches");
    await page.keyboard.press("Tab");
    expect(await focusedPanel()).toBe("commits");

    const firstCursorHash = await page
      .locator(".commit-row-cursor .commit-hash")
      .textContent();
    await page.keyboard.press("j");
    const secondCursorHash = await page
      .locator(".commit-row-cursor .commit-hash")
      .textContent();
    expect(secondCursorHash).not.toBe(firstCursorHash);

    await page.keyboard.press("k");
    expect(
      await page.locator(".commit-row-cursor .commit-hash").textContent(),
    ).toBe(firstCursorHash);

    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector(".top-bar-mode")?.textContent?.startsWith("Commit"),
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row").length === 2,
    );

    await page.keyboard.press("?");
    const help = page.locator('[data-testid="help-overlay"]');
    await help.waitFor();
    expect(await help.textContent()).toContain("Select commit");
    expect(await help.textContent()).toContain("Focus Files");
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });

    await page.keyboard.press("0");
    expect(await focusedPanel()).toBe("diff");
    await page.waitForFunction(
      () => document.querySelectorAll(".diff-line").length > 100,
    );

    const scrollBefore = await page
      .locator(".diff-pane")
      .evaluate((element) => element.scrollTop);
    await page.keyboard.press("j");
    await page.waitForFunction(
      (previous) =>
        (document.querySelector(".diff-pane")?.scrollTop ?? 0) > previous,
      scrollBefore,
    );

    const scrollAfterDown = await page
      .locator(".diff-pane")
      .evaluate((element) => element.scrollTop);
    await page.keyboard.press("k");
    await page.waitForFunction(
      (previous) =>
        (document.querySelector(".diff-pane")?.scrollTop ?? 0) < previous,
      scrollAfterDown,
    );

    await page.keyboard.press("4");
    expect(await focusedPanel()).toBe("files");
    await page.keyboard.press("j");
    expect(await page.locator(".file-row-cursor .file-path").textContent()).toContain(
      "src/beta.ts",
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".diff-heading-path")
        ?.textContent?.includes("src/beta.ts"),
    );

    await page.keyboard.press("0");
    await page.keyboard.press("Tab");
    expect(await focusedPanel()).toBe("worktrees");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".top-bar-mode")?.textContent === "Pending",
    );
  },
  30_000,
);
