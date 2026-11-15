# 37: Overview ruler and jumps from measured layout, not row-count arithmetic

**What to build:** The change overview ruler places marks by row count (`rowIndex / totalRows`). Hunk/file jumping (`currentDiffFileKey`, `paneRowForFile`) does offset arithmetic with a magic `VIEWPORT_TOP_ROWS = 2`. But the scroll height of the diff pane also includes:
- file and commit headings;
- collapsed-file placeholders and binary/image previews;
- in Commit Stack mode, one heading per commit.

So the ruler's marks drift from the lines they point at, worst in Commit Stack mode, and jumps depend on DOM structure. This is finding 14 of `.scratch/reviews/architecture-review-2026-11-15.md`. Ticket 35 (Code View) will reuse the ruler, so fix it first.

**Blocked by:** 33 (same lane; start from `main` after 33 and 34 are merged)

**Status:** done

- [x] A measured layout model: the diff pane exposes a layout of the rendered content, e.g. a `useDiffLayout` hook or a `DiffLayout` object built in `web/`. For each row and each block (file heading, commit heading, collapsed placeholder, image preview) it records the element's `offsetTop` and height within the scroll container.
  - Measure on render and on resize (ResizeObserver).
  - Virtualised long diffs (`forceVirtual`) must be handled: measure the virtual list's row height and offset rather than DOM nodes that aren't mounted.
  - Give rows/blocks stable `data-` keys so lookups don't depend on CSS class names.
- [x] The overview ruler positions each mark at `offsetTop / scrollHeight` of the row(s) it represents, from the layout model. Its click target scrolls to that exact offset. Remove `rowCount`-based maths from `shared/diff/overview.ts`, or keep the pure part (which rows are changed) and move the positioning to the layout model.
- [x] Jumps (`]`/`[` next/previous hunk, `}`/`{` next/previous file) and "current file under the viewport" use the layout model's offsets. Delete `VIEWPORT_TOP_ROWS` and the `.diff-view` / `.diff-lines` query arithmetic. A jump puts the target's top just below the sticky heading, measured from the sticky element's real height and not a constant.
- [x] Tests:
  - Unit tests for the pure parts: changed-row selection, and mapping an offset to the current file.
  - Playwright, in both unified and side-by-side, in single-file and Commit Stack mode, on a fixture with a collapsed large file, an image and three commits:
    - clicking each ruler mark scrolls so that the marked changed line is visible within 1 row of the top;
    - `]` repeatedly visits every hunk in order and `}` every file, with the target line visible under the sticky header each time;
    - a ruler mark's vertical position matches its line's position in the scroll content within 2 px of the ruler height ratio.
  - The existing ruler and navigation Playwright tests pass; update their expectations only where they encoded the old drift, and say so in your report.
  - Run the full `bun test`, `typecheck` and `build`.
