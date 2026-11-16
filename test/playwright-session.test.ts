import { describe, expect, test } from "bun:test";
import {
  createReviewFixture,
  startBrowserSession,
} from "./helpers/browser";

describe("Playwright session", () => {
  test(
    "bootstraps the session cookie without keeping the token in the URL",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      const running = session.running;
      const base = `http://127.0.0.1:${running.port}/`;
      expect(page.url()).toBe(base);
      expect(
        await page.evaluate(() => sessionStorage.getItem("diff4ac-token")),
      ).toBeNull();

      const tokenRequests: string[] = [];
      const onRequest = (request: { url(): string }) => {
        if (request.url().includes("token=")) {
          tokenRequests.push(request.url());
        }
      };
      page.on("request", onRequest);

      try {
        await page.reload();
        await page.waitForSelector(".file-row");
        expect(page.url()).toBe(base);
        expect(tokenRequests).toEqual([]);
        expect(
          await page.evaluate(() => sessionStorage.getItem("diff4ac-token")),
        ).toBeNull();
      } finally {
        page.off("request", onRequest);
      }
    },
    30_000,
  );

  test(
    "shows Worktree Pending counts independently of the current Selection",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const browser = session.browser;
      const running = session.running;
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
        expect(worktreeText).toContain("3 pending");
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
});
