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

/**
 * Wait for the diff pane's scroll offset to stop changing. Jump keys schedule
 * a frame that re-applies the target row, so a later key must not run before
 * that frame has fired.
 */
async function waitForScrollIdle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = Number.NaN;
        let stable = 0;
        const tick = () => {
          const pane = document.querySelector(".diff-pane");
          const top = pane?.scrollTop ?? 0;
          if (top === last) {
            stable += 1;
          } else {
            last = top;
            stable = 0;
          }
          if (stable >= 5) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

describe("Playwright diff", () => {
  test(
    "defaults to side-by-side and toggles to unified with s",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.evaluate(() => sessionStorage.removeItem("diff4ac-diff-view"));
      await page.reload();
      await page.waitForSelector(".file-row");
      await page.locator(".file-row", { hasText: "src/alpha.ts" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/alpha.ts"),
      );

      await page.keyboard.press("0");
      expect(await focusedPanel(page)).toBe("diff");

      await page.waitForFunction(
        () => document.querySelectorAll(".diff-split-row").length > 0,
      );
      expect(await page.locator(".diff-split-cell").count()).toBeGreaterThan(0);
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-token").length > 0,
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".diff-word-added, .diff-word-removed")
            .length > 0,
      );

      await page.keyboard.press("s");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".diff-split-row").length === 0 &&
          document.querySelectorAll(".diff-line").length > 0,
      );

      await page.reload();
      await page.waitForSelector(".file-row");
      await page.locator(".file-row", { hasText: "src/alpha.ts" }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-line").length > 0,
      );
      expect(await page.locator(".diff-split-row").count()).toBe(0);

      await page.keyboard.press("0");
      await page.keyboard.press("s");
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-split-row").length > 0,
      );

      const status = page.locator('[data-testid="status-view"]');
      expect(await status.textContent()).toContain("side-by-side · full file");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll(".diff-content")).some(
          (cell) => cell.textContent?.trim() === "line 1",
        ),
      );
      const fullRows = await page.locator(".diff-split-row").count();

      await page.keyboard.press("c");
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="status-view"]')
            ?.textContent?.includes("hunks only"),
      );
      await page.waitForFunction(
        (previous) =>
          document.querySelectorAll(".diff-split-row").length < previous,
        fullRows,
      );

      const hunkRows = await page.locator(".diff-split-row").count();
      await page.keyboard.press("c");
      await page.waitForFunction(
        (previous) =>
          document.querySelectorAll(".diff-split-row").length > previous,
        hunkRows,
      );
    },
    30_000,
  );

  test(
    "fetches full files per file outside Commit Stack mode",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.evaluate(() => {
        sessionStorage.setItem("diff4ac-full-file", "1");
      });

      const requested: string[] = [];
      const record = (request: { url(): string }) => {
        if (request.url().includes("/api/")) {
          requested.push(request.url());
        }
      };
      page.on("request", record);

      try {
        await page.reload();
        await page.waitForSelector(".file-row");

        await page.locator(".commit-row", { hasText: "second commit" }).click();
        await page.waitForFunction(() =>
          document
            .querySelector(".top-bar-mode")
            ?.textContent?.startsWith("Commit"),
        );
        await page.waitForSelector(".file-row");

        await page.locator(".file-row", { hasText: "src/alpha.ts" }).click();
        await page.waitForFunction(() =>
          Array.from(
            document.querySelectorAll(".diff-content, .diff-line"),
          ).some((line) => line.textContent?.trim() === "line 1"),
        );

        const listRequests = requested.filter((url) =>
          url.includes("/api/commit?"),
        );
        expect(listRequests.length).toBeGreaterThan(0);
        expect(listRequests.some((url) => url.includes("context=full"))).toBe(
          false,
        );

        const fileRequests = requested.filter((url) =>
          url.includes("/api/file-diff?"),
        );
        expect(
          fileRequests.some(
            (url) =>
              url.includes("context=full") && url.includes("src%2Falpha.ts"),
          ),
        ).toBe(true);
      } finally {
        page.off("request", record);
      }
    },
    30_000,
  );

  test(
    "Commit Stack mode still requests and renders whole files",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.evaluate(() => {
        sessionStorage.setItem("diff4ac-full-file", "1");
      });

      const requested: string[] = [];
      const record = (request: { url(): string }) => {
        if (request.url().includes("/api/")) {
          requested.push(request.url());
        }
      };
      page.on("request", record);

      try {
        await page.reload();
        await page.waitForSelector(".file-row");

        await page.keyboard.press("3");
        await page.keyboard.press("j");
        await page.keyboard.press("Space");
        await page.keyboard.press("j");
        await page.keyboard.press("Space");
        await page.waitForFunction(
          () => document.querySelectorAll(".commit-row-selected").length === 2,
        );
        await page.keyboard.press("t");
        await page.waitForFunction(
          () =>
            document.querySelector(".status-mode")?.textContent ===
            "Commit Stack",
        );
        await page.waitForFunction(
          () => document.querySelectorAll(".commit-stack-group").length === 2,
        );
        await page.waitForFunction(() =>
          Array.from(
            document.querySelectorAll(".diff-content, .diff-line"),
          ).some((line) => line.textContent?.trim() === "line 1"),
        );

        const setRequests = requested.filter((url) =>
          url.includes("/api/commit-set?"),
        );
        const stackRequests = setRequests.filter((url) =>
          url.includes("mode=stack"),
        );
        expect(stackRequests.length).toBeGreaterThan(0);
        expect(
          stackRequests.every((url) => url.includes("context=full")),
        ).toBe(true);
      } finally {
        page.off("request", record);
      }
    },
    30_000,
  );

  test(
    "searches the Change Set and jumps between hunks and files",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.reload();
      await page.waitForSelector(".file-row");

      const baseLines = Array.from(
        { length: 240 },
        (_, index) => `line ${index + 1}`,
      );
      repo.write("src/hunks.ts", `${baseLines.join("\n")}\n`);
      repo.commit("hunk baseline");

      const changed = [...baseLines];
      for (let index = 1; index < baseLines.length; index += 20) {
        changed[index] = `line ${index + 1} changed`;
      }
      repo.write("src/hunks.ts", `${changed.join("\n")}\n`);
      repo.write("src/needle-a.ts", "needle alpha\n");
      repo.write("src/needle-b.ts", "needle beta\n");
      repo.write("bun.lock", "lockfile after baseline\n");

      const banner = page.locator('[data-testid="repository-banner"]');
      await banner.waitFor({ timeout: 5000 });
      await page.keyboard.press("r");
      await banner.waitFor({ state: "detached" });
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll(".file-row .file-path")).some(
          (element) => element.textContent?.includes("src/hunks.ts"),
        ),
      );

      await page.locator(".file-row", { hasText: "src/hunks.ts" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/hunks.ts"),
      );
      await page.keyboard.press("0");
      expect(await focusedPanel(page)).toBe("diff");
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-line").length > 0,
      );
      // The whole-file upgrade arrives after the hunks-only render; wait for it
      // before jump keys, otherwise its late render can reset the scroll offset.
      await page.waitForFunction(() => {
        const pane = document.querySelector(".diff-pane");
        return (
          pane instanceof HTMLElement && pane.scrollHeight > pane.clientHeight
        );
      });

      await page.keyboard.press("?");
      const hunkHelp = page.locator('[data-testid="help-overlay"]');
      await hunkHelp.waitFor();
      expect(await hunkHelp.textContent()).toContain("Next hunk");
      expect(await hunkHelp.textContent()).toContain("Next file");
      expect(await hunkHelp.textContent()).toContain("Next match");
      expect(await hunkHelp.textContent()).toContain("Clear search");
      await page.keyboard.press("Escape");
      await hunkHelp.waitFor({ state: "detached" });

      await page
        .locator(".diff-pane")
        .evaluate((element) => element.scrollTo({ top: 0 }));
      await page.keyboard.press("]");
      await page.waitForFunction(
        () => (document.querySelector(".diff-pane")?.scrollTop ?? 0) > 0,
      );
      await waitForScrollIdle(page);
      // The first ] may land on the first hunk, where Previous hunk has nowhere
      // to go, so step once more before checking that [ goes back.
      const firstHunk = await page
        .locator(".diff-pane")
        .evaluate((element) => element.scrollTop);
      await page.keyboard.press("]");
      await page.waitForFunction(
        (previous) =>
          (document.querySelector(".diff-pane")?.scrollTop ?? 0) > previous,
        firstHunk,
      );
      await waitForScrollIdle(page);
      const afterNextHunk = await page
        .locator(".diff-pane")
        .evaluate((element) => element.scrollTop);

      await page.keyboard.press("[");
      await page.waitForFunction(
        (previous) =>
          (document.querySelector(".diff-pane")?.scrollTop ?? 0) < previous,
        afterNextHunk,
      );

      await page.keyboard.press("}");
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/needle-a.ts"),
      );
      await page.keyboard.press("{");
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/hunks.ts"),
      );

      await page.keyboard.press("/");
      const searchInput = page.locator('[data-testid="search-input"]');
      await searchInput.waitFor();
      await searchInput.fill("needle");
      await page.keyboard.press("Enter");
      await searchInput.waitFor({ state: "detached" });

      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/needle-a.ts"),
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-search-match").length > 0,
      );
      expect(
        await page.locator('[data-testid="search-status"]').textContent(),
      ).toContain("1/2 matches");

      await page.keyboard.press("n");
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/needle-b.ts"),
      );
      expect(
        await page.locator('[data-testid="search-status"]').textContent(),
      ).toContain("2/2 matches");

      await page.keyboard.press("N");
      await page.waitForFunction(() =>
        document
          .querySelector(".diff-heading-path")
          ?.textContent?.includes("src/needle-a.ts"),
      );

      await page.keyboard.press("s");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".diff-split-row").length === 0 &&
          document.querySelectorAll(".diff-search-match").length > 0,
      );
      await page.keyboard.press("s");
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-split-row").length > 0,
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-search-match").length > 0,
      );

      await page.keyboard.press("Escape");
      await page
        .locator('[data-testid="search-status"]')
        .waitFor({ state: "detached" });

      const rowsBeforeNoise = await page.locator(".file-row").count();
      await page.keyboard.press("n");
      await page.waitForFunction(
        (previous) => document.querySelectorAll(".file-row").length > previous,
        rowsBeforeNoise,
      );

      await page.keyboard.press("3");
      expect(await focusedPanel(page)).toBe("commits");
      await page.keyboard.press("Space");
      await page.keyboard.press("j");
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () => document.querySelectorAll(".commit-row-selected").length === 2,
      );
      await page.keyboard.press("t");
      await page.waitForFunction(
        () => document.querySelectorAll(".commit-stack-group").length === 2,
      );

      await page.keyboard.press("/");
      await searchInput.waitFor();
      await searchInput.fill("line 39");
      await page.keyboard.press("Enter");
      await searchInput.waitFor({ state: "detached" });
      await page.waitForFunction(
        () => document.querySelectorAll(".diff-search-match").length > 0,
      );
      expect(
        await page.locator('[data-testid="search-status"]').textContent(),
      ).toContain("matches");

      await page.keyboard.press("Escape");
    },
    30_000,
  );

  test(
    "renders the change overview ruler and scrolls the diff pane when clicked",
    async () => {
      const fixture = createReviewFixture();
      const repo = fixture.repo;
      const session = await startBrowserSession(repo);
      const page = session.page;
      await page.reload();
      await page.waitForSelector(".file-row");

      const ruler = page.locator('[data-testid="overview-ruler"]');
      await ruler.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="overview-mark"]').length > 0,
      );
      expect(
        await page.locator('[data-testid="overview-boundary"]').count(),
      ).toBeGreaterThan(0);
      expect(
        await page.locator('[data-testid="overview-viewport"]').count(),
      ).toBe(1);

      // The diff pane loads the whole file after the first hunk render, so wait
      // for it to become scrollable before mapping a click position onto it.
      await page.waitForFunction(() => {
        const pane = document.querySelector(".diff-pane");
        return (
          pane instanceof HTMLElement && pane.scrollHeight > pane.clientHeight
        );
      });

      await page
        .locator(".diff-pane")
        .evaluate((element) => element.scrollTo({ top: 0 }));

      const box = await ruler.boundingBox();
      expect(box).not.toBeNull();
      if (!box) {
        return;
      }

      await ruler.click({
        position: { x: box.width / 2, y: box.height * 0.85 },
      });
      await page.waitForFunction(
        () => (document.querySelector(".diff-pane")?.scrollTop ?? 0) > 0,
      );
    },
    30_000,
  );
});
