import { describe, expect, test } from "bun:test";
import {
  createReviewFixture,
  startBrowserSession,
} from "./helpers/browser";

describe("Playwright filters", () => {
  test(
    "filters extensions, globs and Noise with f and n",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.reload();
      await page.waitForSelector(".file-row");

      expect(await page.locator(".file-row").count()).toBe(2);
      expect(await page.locator(".status-filters").textContent()).toContain(
        "noise on",
      );
      expect(await page.locator(".status-hidden").textContent()).toContain(
        "1 file hidden",
      );

      await page.keyboard.press("n");
      await page.waitForFunction(
        () => document.querySelectorAll(".file-row").length === 3,
      );
      expect(await page.locator(".status-filters").textContent()).not.toContain(
        "noise on",
      );
      expect(await page.locator(".status-hidden").count()).toBe(0);

      await page.keyboard.press("f");
      const dialog = page.locator('[data-testid="filters-dialog"]');
      await dialog.waitFor();
      expect(await dialog.textContent()).toContain(
        "Globs without / match basenames at any depth",
      );
      expect(await dialog.textContent()).toContain("**/*.lock");
      expect(
        await dialog.locator('input[data-extension=".ts"]').count(),
      ).toBe(1);

      await dialog.locator('input[data-extension=".ts"]').uncheck();
      await dialog.getByRole("button", { name: "Apply" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(
        () => document.querySelectorAll(".file-row").length === 1,
      );
      expect(await page.locator(".status-hidden").textContent()).toContain(
        "2 files hidden",
      );
      expect(await page.locator(".status-filters").textContent()).toContain(
        ".ts off",
      );

      await page.keyboard.press("f");
      await dialog.waitFor();
      await dialog.locator('input[data-extension=".ts"]').check();
      await dialog.locator('textarea[data-filter="include"]').fill("src/**");
      await dialog
        .locator('textarea[data-filter="exclude"]')
        .fill("**/gamma.ts");
      await dialog.getByRole("button", { name: "Apply" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".file-row .file-path")
            ?.textContent?.includes("src/alpha.ts") &&
          document
            .querySelector(".status-filters")
            ?.textContent?.includes("include 1"),
      );
      expect(await page.locator(".file-row .file-path").textContent()).toContain(
        "src/alpha.ts",
      );
      expect(await page.locator(".status-hidden").textContent()).toContain(
        "2 files hidden",
      );
      const filtersText = await page.locator(".status-filters").textContent();
      expect(filtersText).toContain("include 1");
      expect(filtersText).toContain("exclude 1");

      await page.keyboard.press("r");
      await page.waitForFunction(
        () =>
          document
            .querySelector(".status-filters")
            ?.textContent?.includes("include 1") &&
          document
            .querySelector(".status-filters")
            ?.textContent?.includes("exclude 1"),
      );

      await page.keyboard.press("3");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() =>
        document.querySelector(".top-bar-mode")?.textContent?.startsWith("Commit"),
      );
      expect(await page.locator(".status-filters").textContent()).toContain(
        "include 1",
      );
      expect(await page.locator(".status-filters").textContent()).toContain(
        "exclude 1",
      );
    },
    30_000,
  );

  test(
    "badges Agent Commits and filters commits by Agent",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
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
});
