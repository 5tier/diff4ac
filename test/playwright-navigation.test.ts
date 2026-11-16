import { describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import {
  createReviewFixture,
  startBrowserSession,
} from "./helpers/browser";

async function focusedPanel(page: Page): Promise<string | null> {
  return page
    .locator('[data-panel][data-focused="true"]')
    .getAttribute("data-panel");
}

describe("Playwright navigation", () => {
  test(
    "navigates panels, lists, diff and help with the keyboard",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      const linkedWorktree = fixture.linkedWorktree;
      expect(await focusedPanel(page)).toBe("files");
      expect(await page.locator(".file-row-cursor .file-path").textContent()).toContain(
        "src/alpha.ts",
      );

      const worktreeRows = page.locator(".worktree-row");
      expect(await worktreeRows.count()).toBe(2);
      const worktreeText = (await worktreeRows.allTextContents()).join("\n");
      expect(worktreeText).toContain(repo.root);
      expect(worktreeText).toContain(linkedWorktree.root);
      expect(worktreeText).toContain("agent-work");
      expect(worktreeText).toContain("3 pending");
      expect(worktreeText).toContain("1 pending");

      await page.keyboard.press("1");
      expect(await focusedPanel(page)).toBe("worktrees");
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
      expect(await focusedPanel(page)).toBe("files");
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
      expect(await focusedPanel(page)).toBe("worktrees");
      await page.keyboard.press("2");
      expect(await focusedPanel(page)).toBe("branches");

      await page.keyboard.press("?");
      const branchHelp = page.locator('[data-testid="help-overlay"]');
      await branchHelp.waitFor();
      const moveDown = branchHelp
        .locator(".help-row", { hasText: "Move down" })
        .first();
      expect(await moveDown.locator(".help-key").textContent()).toBe("b");
      expect(await branchHelp.textContent()).toContain("Esc");
      await page.keyboard.press("Escape");
      await branchHelp.waitFor({ state: "detached" });

      const branchCursor = await page
        .locator('[data-panel="branches"]')
        .getAttribute("data-cursor");
      await page.keyboard.press("b");
      await page.waitForFunction(
        (previous) =>
          document
            .querySelector('[data-panel="branches"]')
            ?.getAttribute("data-cursor") !== previous,
        branchCursor,
      );

      await page.keyboard.press("3");
      expect(await focusedPanel(page)).toBe("commits");
      await page.keyboard.press("4");
      expect(await focusedPanel(page)).toBe("files");
      await page.keyboard.press("0");
      expect(await focusedPanel(page)).toBe("diff");
      await page.keyboard.press("Tab");
      expect(await focusedPanel(page)).toBe("worktrees");
      await page.keyboard.press("Tab");
      expect(await focusedPanel(page)).toBe("branches");
      await page.keyboard.press("Tab");
      expect(await focusedPanel(page)).toBe("commits");

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
      expect(await help.textContent()).toContain("Open Filters");
      expect(await help.textContent()).toContain("Toggle Noise");
      await page.keyboard.press("Escape");
      await help.waitFor({ state: "detached" });

      await page.keyboard.press("0");
      expect(await focusedPanel(page)).toBe("diff");
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
      expect(await focusedPanel(page)).toBe("files");
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
      expect(await focusedPanel(page)).toBe("worktrees");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => document.querySelector(".top-bar-mode")?.textContent === "Pending",
      );
    },
    30_000,
  );

  test(
    "switches the Files panel to a folder tree with T",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const browser = session.browser;
      const running = session.running;
      const treePage = await browser.newPage({
        viewport: { width: 1200, height: 800 },
      });

      try {
        await treePage.goto(running.url);
        await treePage.waitForSelector(".file-row");
        await treePage.keyboard.press("4");
        await treePage.keyboard.press("T");
        await treePage.waitForSelector(".folder-row");

        expect(await treePage.locator(".folder-row").count()).toBeGreaterThan(0);
        expect(
          (await treePage.locator(".folder-row").allTextContents()).join("\n"),
        ).toContain("src");

        // h moves from the file to its parent folder, then collapses it.
        await treePage.keyboard.press("h");
        await treePage.waitForFunction(
          () =>
            document
              .querySelector(".folder-row-cursor")
              ?.getAttribute("data-folder-path") === "src",
        );
        await treePage.keyboard.press("h");
        await treePage.waitForFunction(
          () => document.querySelectorAll(".file-row").length === 0,
        );

        // l expands the folder again and j moves onto its first file.
        await treePage.keyboard.press("l");
        await treePage.waitForFunction(
          () => document.querySelectorAll(".file-row").length > 0,
        );
        await treePage.keyboard.press("j");
        await treePage.waitForFunction(
          () => document.querySelector(".file-row-cursor") !== null,
        );
        await treePage.keyboard.press("Enter");
        await treePage.waitForFunction(() =>
          document
            .querySelector(".diff-heading-path")
            ?.textContent?.includes("src/alpha.ts"),
        );

        await treePage.keyboard.press("m");
        await treePage.waitForFunction(
          () => document.querySelectorAll(".file-row-reviewed").length === 1,
        );
        await treePage.keyboard.press("m");
        await treePage.waitForFunction(
          () => document.querySelectorAll(".file-row-reviewed").length === 0,
        );

        await treePage.reload();
        await treePage.waitForSelector(".folder-row");
        expect(await treePage.locator(".file-row").count()).toBeGreaterThan(0);
      } finally {
        await treePage.close();
      }
    },
    30_000,
  );

  test(
    "loads the next Commits page when the cursor reaches the last loaded row",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo, {
        commitPageSize: 2,
        waitForSelector: ".commit-row",
      });
      const paged = session.running;
      const pagedPage = session.page;
      try {
        await pagedPage.keyboard.press("3");

        await pagedPage.waitForFunction(
          () => document.querySelectorAll(".commit-row").length === 2,
        );
        const more = pagedPage.locator('[data-testid="commit-more"]');
        await more.waitFor();
        const firstPage = await pagedPage
          .locator(".commit-row .commit-message")
          .allTextContents();

        await pagedPage.keyboard.press("j");
        await pagedPage.waitForFunction(
          () => document.querySelectorAll(".commit-row").length > 2,
        );

        const all = await pagedPage
          .locator(".commit-row .commit-message")
          .allTextContents();
        expect(all.slice(0, 2)).toEqual(firstPage);

        await pagedPage.keyboard.press("j");
        await pagedPage.keyboard.press("Enter");
        await pagedPage.waitForFunction(() =>
          document
            .querySelector(".top-bar-mode")
            ?.textContent?.startsWith("Commit"),
        );
        expect(await pagedPage.locator(".status-selection").textContent()).toBe(
          all[2]!,
        );
      } finally {
        await pagedPage.close();
        paged.stop();
      }
    },
    30_000,
  );
});
