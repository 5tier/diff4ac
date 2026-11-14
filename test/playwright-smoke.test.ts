import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type RunningServer } from "../src/server/server";
import {
  createFixtureRepo,
  type FixtureCheckout,
  type FixtureRepo,
} from "./helpers/fixture";
import { createTempHome, type TempHome } from "./helpers/home";

const PROJECT_ROOT = join(import.meta.dir, "..");

let repo: FixtureRepo;
let linkedWorktree: FixtureCheckout;
let running: RunningServer;
let browser: Browser;
let page: Page;
let stateDir: string;
let home: TempHome;

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
  repo.commit("second commit", {
    trailers: ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"],
  });

  repo.write("src/beta.ts", "beta three\n");
  repo.commit("third commit");

  linkedWorktree = repo.addWorktree("agent", { branch: "agent-work" });
  linkedWorktree.write("src/linked.ts", "linked history\n");
  linkedWorktree.commit("linked history");

  repo.write("src/main-only.ts", "main only\n");
  repo.commit("main after linked");
  repo.git(["branch", "doomed"]);

  repo.write("src/alpha.ts", `${longFile}changed again\n`);
  repo.write("src/gamma.ts", "pending gamma\n");
  linkedWorktree.write("src/linked.ts", "linked pending\n");

  repo.write(".git/info/exclude", ".diff4ac.json\n");
  repo.write(
    ".diff4ac.json",
    `${JSON.stringify({ keybindings: { "branches.moveDown": "n" } })}\n`,
  );

  stateDir = mkdtempSync(join(tmpdir(), "diff4ac-playwright-state-"));
  home = createTempHome();
  running = await startServer({
    repoPath: repo.root,
    stateDir,
    homeDir: home.path,
  });
  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(running.url);
  await page.waitForSelector(".file-row");
}, 30_000);

afterAll(async () => {
  await browser?.close();
  running?.stop();
  repo?.dispose();
  if (stateDir) {
    rmSync(stateDir, { recursive: true, force: true });
  }
  home?.dispose();
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
    await page.waitForFunction(() =>
      document
        .querySelector('[data-panel="commits"]')
        ?.textContent?.includes("linked history"),
    );
    expect(
      await page.locator('[data-panel="commits"]').textContent(),
    ).not.toContain("main after linked");
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-branch-name="agent-work"]')
          ?.getAttribute("data-current") === "true",
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
    await page.waitForFunction(() =>
      document
        .querySelector('[data-panel="commits"]')
        ?.textContent?.includes("main after linked"),
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-branch-name="main"]')
          ?.getAttribute("data-current") === "true",
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

    await page.keyboard.press("?");
    const branchHelp = page.locator('[data-testid="help-overlay"]');
    await branchHelp.waitFor();
    const moveDown = branchHelp
      .locator(".help-row", { hasText: "Move down" })
      .first();
    expect(await moveDown.locator(".help-key").textContent()).toBe("n");
    await page.keyboard.press("Escape");
    await branchHelp.waitFor({ state: "detached" });

    const branchCursor = await page
      .locator('[data-panel="branches"]')
      .getAttribute("data-cursor");
    await page.keyboard.press("n");
    await page.waitForFunction(
      (previous) =>
        document
          .querySelector('[data-panel="branches"]')
          ?.getAttribute("data-cursor") !== previous,
      branchCursor,
    );

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

    await page.keyboard.press("w");
    const timeWindowDialog = page.locator('[data-testid="time-window-dialog"]');
    await timeWindowDialog.waitFor();
    expect(await timeWindowDialog.getAttribute("data-mode")).toBe("list");
    await page.keyboard.press("Enter");
    await timeWindowDialog.waitFor({ state: "detached" });
    await page.waitForFunction(() =>
      document.querySelector(".top-bar-mode")?.textContent?.includes(
        "Time Window",
      ),
    );
    await page.waitForFunction(() =>
      document
        .querySelector('[data-panel="files"]')
        ?.textContent?.includes("No commits landed in this Time Window."),
    );

    await page.keyboard.press("w");
    await timeWindowDialog.waitFor();
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="time-window-dialog"]')
          ?.getAttribute("data-mode") === "custom",
    );
    const dateInputs = page.locator(".time-window-field input");
    await dateInputs.nth(0).fill("2024-01-01");
    await dateInputs.nth(1).fill("2024-01-03");
    await page.keyboard.press("Enter");
    await timeWindowDialog.waitFor({ state: "detached" });
    await page.waitForFunction(() =>
      document.querySelector(".status-selection")?.textContent?.includes(
        "2024-01-01",
      ),
    );

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
    await page.keyboard.press("j");
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
    expect(await help.textContent()).toContain("Pick or unpick commit");
    expect(await help.textContent()).toContain("Toggle Net Diff / Commit Stack");
    expect(await help.textContent()).toContain("Choose a Time Window");
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

test(
  "picks commits with Space and v and toggles Net Diff and Commit Stack with t",
  async () => {
    await page.reload();
    await page.waitForSelector(".file-row");

    await page.keyboard.press("3");
    expect(await focusedPanel()).toBe("commits");

    await page.keyboard.press("Space");
    await page.keyboard.press("j");
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () => document.querySelectorAll(".commit-row-selected").length === 2,
    );
    await page.waitForFunction(
      () => document.querySelector(".status-mode")?.textContent === "Net Diff",
    );

    await page.keyboard.press("t");
    await page.waitForFunction(
      () =>
        document.querySelector(".status-mode")?.textContent === "Commit Stack",
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".commit-stack-group").length === 2,
    );

    const headers = await page
      .locator(".commit-stack-heading .commit-stack-message")
      .allTextContents();
    expect(headers).toEqual(["third commit", "main after linked"]);

    await page.keyboard.press("t");
    await page.waitForFunction(
      () => document.querySelector(".status-mode")?.textContent === "Net Diff",
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".commit-stack-group").length === 0,
    );

    await page.keyboard.press("Space");
    await page.keyboard.press("j");
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".status-mode")
          ?.textContent?.includes("non-contiguous") ?? false,
    );
    const note = page.locator(".selection-note");
    await note.waitFor();
    expect(await note.textContent()).toContain("Commit Stack only");

    await page.keyboard.press("t");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".status-mode")
          ?.textContent?.includes("non-contiguous") ?? false,
    );

    await page.reload();
    await page.waitForSelector(".file-row");
    await page.keyboard.press("3");
    await page.keyboard.press("v");
    await page.keyboard.press("j");
    await page.waitForFunction(
      () => document.querySelectorAll(".commit-row-selected").length === 2,
    );
    await page.waitForFunction(
      () => document.querySelector(".status-mode")?.textContent === "Net Diff",
    );
  },
  30_000,
);

test(
  "toggles and persists Review Marks with m",
  async () => {
    await page.reload();
    await page.waitForSelector(".file-row");
    await page.keyboard.press("4");

    await page.keyboard.press("?");
    const help = page.locator('[data-testid="help-overlay"]');
    await help.waitFor();
    expect(await help.textContent()).toContain("Toggle Review Mark");
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });

    expect(await page.locator(".file-row-reviewed").count()).toBe(0);

    const firstMark = page.waitForResponse(
      (response) =>
        response.url().includes("/api/review-mark") &&
        response.request().method() === "POST",
    );
    await page.keyboard.press("m");
    await firstMark;
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row-reviewed").length === 1,
    );
    expect(
      await page.locator(".review-progress").textContent(),
    ).toContain("1/2 reviewed");

    await page.reload();
    await page.waitForSelector(".file-row");
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row-reviewed").length === 1,
    );
    expect(
      await page.locator(".review-progress").textContent(),
    ).toContain("1/2 reviewed");

    await page.keyboard.press("4");
    const unmark = page.waitForResponse(
      (response) =>
        response.url().includes("/api/review-mark") &&
        response.request().method() === "POST",
    );
    await page.keyboard.press("m");
    await unmark;
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row-reviewed").length === 0,
    );
    expect(
      await page.locator(".review-progress").textContent(),
    ).toContain("0/2 reviewed");
  },
  30_000,
);

test(
  "shows the Repository changed banner and refreshes only on r",
  async () => {
    await page.reload();
    await page.waitForSelector(".file-row");

    await page.keyboard.press("4");
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".diff-heading-path")
        ?.textContent?.includes("src/gamma.ts"),
    );
    expect(await page.locator(".file-row").count()).toBe(2);

    repo.write("src/delta.ts", "delta\n");

    const banner = page.locator('[data-testid="repository-banner"]');
    await banner.waitFor({ timeout: 5000 });
    expect(await page.locator(".file-row").count()).toBe(2);
    expect(
      await page.locator(".diff-heading-path").textContent(),
    ).toContain("src/gamma.ts");

    await page.keyboard.press("r");
    await banner.waitFor({ state: "detached" });
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row").length === 3,
    );
    expect(
      await page.locator(".diff-heading-path").textContent(),
    ).toContain("src/gamma.ts");
  },
  30_000,
);

test(
  "falls back to Pending with a notice when the selected branch disappears",
  async () => {
    await page.reload();
    await page.waitForSelector(".branch-row");

    await page.keyboard.press("2");
    await page.locator(".branch-row", { hasText: "doomed" }).click();
    await page.waitForFunction(() =>
      document.querySelector(".top-bar-mode")?.textContent?.includes(
        "Branch doomed",
      ),
    );

    repo.git(["branch", "-D", "doomed"]);

    const banner = page.locator('[data-testid="repository-banner"]');
    await banner.waitFor({ timeout: 5000 });
    await page.keyboard.press("r");
    await banner.waitFor({ state: "detached" });
    await page.waitForFunction(
      () => document.querySelector(".top-bar-mode")?.textContent === "Pending",
    );

    const notice = page.locator('[data-testid="refresh-notice"]');
    await notice.waitFor();
    expect(await notice.textContent()).toContain("no longer exists");
  },
  30_000,
);

test(
  "lapses a Review Mark for changed content after refresh",
  async () => {
    await page.reload();
    await page.waitForSelector(".file-row");
    await page.keyboard.press("4");

    const marked = page.waitForResponse(
      (response) =>
        response.url().includes("/api/review-mark") &&
        response.request().method() === "POST",
    );
    await page.keyboard.press("m");
    await marked;
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row-reviewed").length === 1,
    );

    repo.append("src/alpha.ts", "changed after marking\n");

    const banner = page.locator('[data-testid="repository-banner"]');
    await banner.waitFor({ timeout: 5000 });
    await page.keyboard.press("r");
    await banner.waitFor({ state: "detached" });
    await page.waitForFunction(
      () => document.querySelectorAll(".file-row-reviewed").length === 0,
    );
  },
  30_000,
);

test(
  "badges Agent Commits and filters commits by Agent",
  async () => {
    await page.reload();
    await page.waitForSelector(".commit-row");
    await page.keyboard.press("3");

    await page.waitForFunction(() =>
      document
        .querySelector('[data-panel="commits"]')
        ?.textContent?.includes("🤖 Claude Code"),
    );
    const allCommits = await page.locator(".commit-row").count();
    expect(allCommits).toBeGreaterThan(1);

    await page.keyboard.press("a");
    await page.waitForFunction(
      () => document.querySelectorAll(".commit-row").length === 1,
    );
    expect(
      await page.locator(".commit-row .commit-message").textContent(),
    ).toBe("second commit");
    expect(await page.locator(".status-agent").textContent()).toContain(
      "agent: Claude Code",
    );

    await page.keyboard.press("a");
    await page.waitForFunction(
      (count) => document.querySelectorAll(".commit-row").length === count,
      allCommits,
    );
    expect(await page.locator(".status-agent").textContent()).toContain(
      "agent: all",
    );
  },
  30_000,
);
