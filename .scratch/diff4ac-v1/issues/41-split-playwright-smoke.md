# 41: Split the Playwright smoke file by feature

**What to build:** This is the rest of finding 13 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Already done:**
- server test helpers (`test/helpers/server.ts`, `cleanup.ts`);
- gateway option tests;
- reducer tests.

**What remains:** `test/playwright-smoke.test.ts` is 1,688 lines with 21 top-level tests, no `describe` grouping, and one shared fixture repository, server, browser and page built in a 60-line `beforeAll`. A failure there is hard to diagnose, and tests can depend on state left behind by earlier ones. Split it into feature files whose tests stand on their own.

**Blocked by:** none. Ticket 40 (split `src/changeset/files.ts`) runs in parallel. Touch only `test/` (Playwright files and a new shared helper), not `src/` or `web/`.

**Status:** done

- [x] A shared Playwright helper, e.g. `test/helpers/browser.ts`:
  - `launchChromium()` (moved from the smoke file and `playwright-layout.test.ts`, which duplicate it);
  - the SPA build check (build once per run if `dist/web` is missing);
  - a `startBrowserSession(repo, options)` that starts a server with a temp HOME and state dir and opens a page that bootstraps the session cookie.
  - Everything is registered with the cleanup registry from `test/helpers/cleanup.ts`. Browser and server are closed in `finally`/the registry, even on failure.
  - Use it from the existing `playwright-layout` and `playwright-code-view` files only where it is a mechanical swap.
- [x] Split the 21 tests by feature, e.g.:
  - `playwright-session.test.ts`: cookie bootstrap, Worktree counts;
  - `playwright-navigation.test.ts`: panels, keyboard, help, Files tree `T`, commit paging;
  - `playwright-selection.test.ts`: picks, Net Diff/Commit Stack, the fallbacks when a branch or commit disappears;
  - `playwright-review.test.ts`: Review Marks and lapsing;
  - `playwright-filters.test.ts`: filters, Noise, Agent badges and filter;
  - `playwright-diff.test.ts`: side-by-side/unified, full-file fetching, Commit Stack whole files, search and jumps, the overview ruler;
  - `playwright-toolbar.test.ts`: toolbar actions, single-row fit, theme.

  Group within a file with `describe`. Each file builds its own fixture (copy only the parts of the big fixture it needs) and can run alone with `bun test test/playwright-<x>.test.ts`.
- [x] No hidden ordering:
  - Any test that relied on state from an earlier test (selection, marks, sessionStorage, theme, the deleted `doomed` branch, rewritten commits) gets that state from its own setup.
  - Prove it by running each new file alone, and by running the Playwright files in reverse order (`bun test` with the file list reversed) once.
- [x] Keep every assertion. The test names may get a `describe` prefix, but each old test maps to exactly one new test; list the mapping (old name → file › new name) in your report. Delete `test/playwright-smoke.test.ts` when it is empty.
- [x] Waits: replace fixed `waitForTimeout` sleeps you touch with waits on settled state, as `playwright-layout.test.ts` does. Don't add new fixed sleeps.
- [x] Runtime: report full-suite time before and after. Separate fixtures will cost some time; keep the increase reasonable, e.g. under 30%. A fixture that several files need may come from a shared builder function.
- [x] Verification:
  - plain `bun test` 3 times (no `--isolate`), with 0 leaked temp dirs (the preload guard);
  - typecheck and build;
  - the total test count equals the old count.
