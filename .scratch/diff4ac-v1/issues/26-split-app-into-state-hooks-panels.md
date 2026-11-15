# 26: Split web/app.tsx into a pure state module, hooks and panel components

**What to build:** `web/app.tsx` is 2,601 lines.
- The `App` component (`:886`) holds 60+ `useState`s for loading, selection, cursors, filters, search, time windows, theme, review marks, expansion, full-file cache and errors.
- `dispatch` is a callback of more than 300 lines with about 30 dependencies. The `keydown` listener effect re-registers on almost every state change.
- The file also contains every row component, CommitStackView, HelpOverlay, TimeWindowDialog and the selection helpers.

This is a **pure refactor: no visible behaviour change**. The same keys, toolbar, panels, URLs and requests, sessionStorage/localStorage keys, and ARIA/DOM structure that the Playwright tests rely on all stay the same. This is finding 2 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none (runs in parallel with 25, which only touches `src/server/`; don't edit `src/` except to import from it)

**Status:** done

- [x] Work in safe steps and keep the suite green after each:
  1. Move the presentational components out of `app.tsx` into `web/panels/`:
     - `Panel`, `FileRow`, `CommitRow`, `WorktreeRow`, `BranchRow` (one file each, or grouped by panel);
     - `CommitStackView`, `HelpOverlay`, `TimeWindowDialog`.
  2. Move the pure selection/label helpers into `web/state/selection.ts`: `selectionLabel`, `selectionBadge`, `modeLabel`, `selectionFromPicks`, `selectionFromTimeWindow`, `sameTimeWindowSelection`, `selectionIncludesCommit`, `selectionCacheKey`, `fullFileCacheKey`, `setChangeFileReviewState`, `replaceChangeFile`, filter summaries, etc.
  3. Introduce `web/state/app-state.ts`: typed `AppState`, a discriminated union `AppAction`, and a pure `appReducer(state, action)` for the UI state now spread over `useState`s: panel focus, cursors, selection and picks, selected path, dialogs, search, diff view, full-file, theme and expansion. Reducer actions never fetch. IO stays in hooks/effects.
  4. Extract hooks, e.g. `useRepositoryData` (worktrees, branches, commits, pending, refresh, SSE banner), `useChangeSet` (the Selection fetch effect plus the full-file overlay/cache), `useSearch`, `useKeyboard`.
  5. `dispatch(action, panel)` translates a keymap action into reducer actions plus the few IO calls (review mark, expand-diff, refresh). It is still shared by keys and toolbar clicks.
- [x] The keydown listener is registered once. It reads the latest state and dispatch through a ref, so it is not re-registered on every state change.
- [x] `App` ends up as composition only, under ~400 lines. No new file exceeds ~500 lines.
- [x] Tests:
  - Add `test/app-reducer.test.ts`: table-driven reducer tests for at least these transitions:
    - cursor moves and clamping;
    - pick/unpick commits into a commit Selection and a commits Selection;
    - picking a time window;
    - toggling full-file, the diff view and the theme cycle;
    - opening/closing help, search and the filters dialog;
    - Selection change resetting the selected path and cursors.
  - Unit-test the moved selection helpers.
  - The existing Playwright suite (`test/playwright-smoke.test.ts`) passes **without changing its assertions or selectors**.
  - Run `bun test`, `typecheck` and `build`.
