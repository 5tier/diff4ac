import { describe, expect, test } from "bun:test";
import {
  createReviewFixture,
  startBrowserSession,
} from "./helpers/browser";

describe("Playwright toolbar", () => {
  test(
    "command toolbar runs the same actions as s, c and t",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.evaluate(() => {
        sessionStorage.removeItem("diff4ac-diff-view");
        sessionStorage.removeItem("diff4ac-full-file");
      });
      await page.reload();
      await page.waitForSelector(".file-row");

      const toolbar = page.locator('[data-testid="command-toolbar"]');
      await toolbar.waitFor();

      const toggleView = page.locator(
        '[data-binding-id="global.toggleDiffView"]',
      );
      const toggleFullFile = page.locator(
        '[data-binding-id="global.toggleFullFile"]',
      );
      const toggleMode = page.locator('[data-binding-id="commits.toggleMode"]');

      expect(await toggleView.locator("kbd").textContent()).toBe("s");
      expect(await toggleFullFile.locator("kbd").textContent()).toBe("c");
      expect(await toggleMode.locator("kbd").textContent()).toBe("t");

      const statusView = page.locator('[data-testid="status-view"]');
      expect(await statusView.textContent()).toContain("side-by-side · full file");

      await toggleView.click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="status-view"]')
          ?.textContent?.includes("unified"),
      );
      await page.keyboard.press("s");
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="status-view"]')
          ?.textContent?.includes("side-by-side"),
      );

      await toggleFullFile.click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="status-view"]')
          ?.textContent?.includes("hunks only"),
      );
      await page.keyboard.press("c");
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="status-view"]')
          ?.textContent?.includes("full file"),
      );

      await page.keyboard.press("3");
      await page.keyboard.press("Space");
      await page.keyboard.press("j");
      await page.keyboard.press("Space");
      await page.waitForFunction(() =>
        document.querySelector(".status-mode")?.textContent?.includes("Net Diff"),
      );

      await toggleMode.click();
      await page.waitForFunction(() =>
        document
          .querySelector(".status-mode")
          ?.textContent?.includes("Commit Stack"),
      );
      await page.keyboard.press("t");
      await page.waitForFunction(() =>
        document.querySelector(".status-mode")?.textContent?.includes("Net Diff"),
      );
    },
    30_000,
  );

  test(
    "keeps the command toolbar on a single row with labels when they fit",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.reload();
      await page.waitForSelector(".file-row");

      const toolbar = page.locator('[data-testid="command-toolbar"]');
      const label = page.locator(
        '.toolbar-button[data-binding-id="global.toggleDiffView"] .toolbar-label',
      );

      try {
        await page.setViewportSize({ width: 1400, height: 800 });
        await page.waitForFunction(
          () => {
            const element = document.querySelector(
              '[data-testid="command-toolbar"]',
            );
            return (
              element !== null && element.scrollWidth <= element.clientWidth
            );
          },
          undefined,
          { timeout: 5000 },
        );

        const height = await toolbar.evaluate(
          (element) => element.getBoundingClientRect().height,
        );
        expect(height).toBeLessThanOrEqual(32);

        const tops = await page
          .locator(".toolbar-button")
          .evaluateAll((buttons) =>
            buttons.map((button) =>
              Math.round(button.getBoundingClientRect().top),
            ),
          );
        expect(new Set(tops).size).toBe(1);

        const everyButtonVisible = await page.evaluate(() => {
          const container = document
            .querySelector('[data-testid="command-toolbar"]')
            ?.getBoundingClientRect();
          if (!container) {
            return false;
          }
          return Array.from(document.querySelectorAll(".toolbar-button")).every(
            (button) => {
              const box = button.getBoundingClientRect();
              return (
                box.left >= container.left - 0.5 &&
                box.right <= container.right + 0.5
              );
            },
          );
        });
        expect(everyButtonVisible).toBe(true);

        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
        ).toBe(true);

        await page.setViewportSize({ width: 700, height: 800 });
        await page.waitForFunction(
          () =>
            document
              .querySelector(".command-toolbar-wrap")
              ?.getAttribute("data-compact") === "true",
        );

        expect(
          await toolbar.evaluate(
            (element) => element.getBoundingClientRect().height,
          ),
        ).toBeLessThanOrEqual(32);
        expect(
          await label.evaluate((element) => getComputedStyle(element).display),
        ).toBe("none");
        expect(
          await toolbar.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        ).toBe(true);

        await toolbar.evaluate((element) => element.scrollTo({ left: 0 }));
        await toolbar.hover();
        await page.mouse.wheel(0, 240);
        await page.waitForFunction(
          () =>
            (document.querySelector('[data-testid="command-toolbar"]')
              ?.scrollLeft ?? 0) > 0,
        );

        const toggleView = page.locator(
          '[data-binding-id="global.toggleDiffView"]',
        );
        await toggleView.scrollIntoViewIfNeeded();
        await toggleView.click();
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="status-view"]')
              ?.textContent?.includes("unified") ?? false,
        );

        await page.setViewportSize({ width: 2600, height: 800 });
        await page.waitForFunction(() => {
          const element = document.querySelector(
            '.toolbar-button[data-binding-id="global.toggleDiffView"] .toolbar-label',
          );
          return (
            element !== null && getComputedStyle(element).display !== "none"
          );
        });
        expect(
          await page
            .locator(".command-toolbar-wrap")
            .getAttribute("data-compact"),
        ).toBeNull();
        expect(
          await toolbar.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      } finally {
        await page.setViewportSize({ width: 1200, height: 800 });
      }
    },
    30_000,
  );

  test(
    "cycles and persists the theme with D and the toolbar button",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate(() => localStorage.removeItem("diff4ac-theme"));
      await page.reload();
      await page.waitForSelector(".file-row");

      const theme = () =>
        page.locator("html").getAttribute("data-theme");
      const background = () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--bg")
            .trim(),
        );
      const themeButton = page.locator('[data-binding-id="global.cycleTheme"]');
      const themeValue = () => themeButton.locator(".toolbar-value").textContent();

      try {
        expect(await theme()).toBe("system");
        expect(await background()).toBe("#f7f8fa");
        expect(await themeValue()).toBe("System");

        await page.keyboard.press("D");
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === "light",
        );
        expect(await background()).toBe("#f7f8fa");
        expect(await themeValue()).toBe("Light");

        await page.keyboard.press("D");
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === "dark",
        );
        expect(await background()).toBe("#101214");
        expect(await themeValue()).toBe("Dark");

        await page.reload();
        await page.waitForSelector(".file-row");
        expect(await theme()).toBe("dark");
        expect(await background()).toBe("#101214");

        await themeButton.click();
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === "system",
        );
        expect(await themeValue()).toBe("System");
        expect(await background()).toBe("#f7f8fa");

        await themeButton.click();
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === "light",
        );
        await page.reload();
        await page.waitForSelector(".file-row");
        expect(await theme()).toBe("light");
        expect(await background()).toBe("#f7f8fa");
        expect(await themeValue()).toBe("Light");
      } finally {
        await page
          .evaluate(() => localStorage.removeItem("diff4ac-theme"))
          .catch(() => {});
        await page.emulateMedia({ colorScheme: null });
        await page.reload().catch(() => {});
      }
    },
    30_000,
  );
});
