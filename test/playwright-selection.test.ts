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

describe("Playwright selection", () => {
  test(
    "picks commits with Space and v and toggles Net Diff and Commit Stack with t",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.reload();
      await page.waitForSelector(".file-row");

      await page.keyboard.press("3");
      expect(await focusedPanel(page)).toBe("commits");

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
    "shows the Repository changed banner and refreshes only on r",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
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
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
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
    "falls back to Pending when the selected commit is rewritten away",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.reload();
      await page.waitForSelector(".file-row");

      repo.write("src/rewrite.ts", "one\n");
      repo.stage("src/rewrite.ts");
      repo.commit("rewrite me", { addAll: false });

      const banner = page.locator('[data-testid="repository-banner"]');
      await banner.waitFor({ timeout: 5000 });
      await page.keyboard.press("r");
      await banner.waitFor({ state: "detached" });

      await page.keyboard.press("3");
      await page.locator(".commit-row", { hasText: "rewrite me" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".top-bar-mode")
          ?.textContent?.startsWith("Commit"),
      );

      repo.write("src/rewrite.ts", "two\n");
      repo.stage("src/rewrite.ts");
      repo.git(["commit", "--amend", "--no-edit", "-m", "rewritten away"]);
      repo.git(["reflog", "expire", "--expire=now", "--all"]);
      repo.git(["gc", "--prune=now", "--quiet"]);

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
});
