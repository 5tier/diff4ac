# 48: Browser tests leave Chromium temp folders behind

**What to build:** every test process that uses Playwright leaves a `playwright_chromiumdev_profile-*` folder, and often a `playwright-artifacts-*` folder, in `$TMPDIR`. Running one browser test file on main took the profile count from 430 to 431, and three full `bun test` runs added 6. About 437 profile folders and 435 artifact folders have built up so far.

The likely cause:
- `launchChromium()` in `test/helpers/browser.ts` registers `registerSuiteCleanup(() => { void promise.then((browser) => browser.close()) })`.
- `test/helpers/cleanup.ts` runs cleanups synchronously, so `browser.close()` is never awaited.
- The test process exits before Playwright removes its profile and artifacts folders.

Confirm this before fixing it.

**Blocked by:** none.

**Status:** done

- [x] Reproduce it. Count both folder kinds in `$TMPDIR` before and after `bun test test/playwright-diff.test.ts`, and after a full `bun test`.
- [x] Fix it so the browser is closed and awaited before the process exits.
  - For example: let suite cleanups return a promise and await them from the global preload's `afterAll`; or close the browser in an awaited `afterAll` in `test/helpers/browser.ts`.
  - Keep the per-test cleanup order: pages and contexts close before temp repos are removed.
  - A failing close must not hide other cleanups.
  - Don't change what the tests assert, and don't add fixed sleeps.
- [x] Check every place that launches a browser or creates a context: the `playwright-*` files, `markdown-sanitize`, `playwright-code-view`, and any others. They should all go through the shared helper or close their own browser, awaited.
- [x] Add a check that fails if a browser test leaves a new `playwright_chromiumdev_profile-*` or `playwright-artifacts-*` folder behind. One way: a test that runs `bun test test/playwright-diff.test.ts` in a subprocess and compares the folders that exist before and after by name, not by count, so other processes' folders don't interfere. If this is too slow or flaky for the normal suite, explain why and propose an alternative.
- [x] Don't delete the existing leftover folders. I'll decide about those with the user.
- [x] Run a full `bun test` 3 times, each time listing new profile and artifacts folders by name (expect none), then typecheck and build.
