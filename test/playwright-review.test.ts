import { describe, expect, test } from "bun:test";
import {
  createReviewFixture,
  startBrowserSession,
} from "./helpers/browser";

describe("Playwright review", () => {
  test(
    "toggles and persists Review Marks with m",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
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
    "lapses a Review Mark for changed content after refresh",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
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
});
