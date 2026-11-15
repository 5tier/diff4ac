# 35: Code View: browse the Selection's Snapshot as a folder tree with whole files

**What to build:** The **Code View** mode (see `CONTEXT.md`). The Reviewer toggles it with `o`. The left side shows a folder tree of the whole **Snapshot** for the current Selection; the right side shows the open file, syntax-highlighted, with margin marks on lines the Selection added or changed. It uses the Snapshot API from ticket 34 and the `FolderTree` component and `shared/folder-tree.ts` from ticket 33. This is the design agreed on 2026-11-15.

**Blocked by:** 33, 34

**Status:** done

- [x] Mode:
  - Global binding `global.toggleCodeView` on `o`, with a View-group toolbar button.
  - Code View replaces the whole layout: the tree panel on the left at full height, the code pane on the right. The top bar and status bar stay; the status bar shows `Code View · after|before · <Snapshot label>`. `o` returns to the review layout exactly as it was.
  - Help overlay and keymap entries are added for every new key.
- [x] Which Snapshot:
  - It follows the current Selection's **after** state.
  - `b` flips between after and before, and the toolbar shows the current side.
  - Changing Selection, Worktree or refresh (`r`) reloads the Snapshot. Code View stays open, and the open file stays open if it still exists at the new Snapshot (otherwise the tree root).
- [x] Tree:
  - The `FolderTree` component, fed lazily from `/api/snapshot/tree` per expanded folder; folders expand on demand.
  - Status badges come from the API (M/A/D/R).
  - Folders with `containsChanges` show a dot. Noise entries are dimmed.
  - Deleted entries are greyed and struck through; renamed old paths show `→ new path`.
  - Keys:
    - `j`/`k` move;
    - `l` expands a folder;
    - `Enter` opens a file (on a folder it toggles);
    - `h` collapses a folder, or jumps to its parent;
    - `}`/`{` jump to the next/previous changed file in tree order, loading and expanding folders as needed. Use the change paths from the Selection's Change Set, which the app already has, to find the targets.
  - `Tab` cycles tree ↔ code and `0` focuses the code pane. Number keys `1`–`4`, which focus review-layout panels, are inert in Code View.
- [x] Code pane:
  - Whole-file content from `/api/snapshot/file`, with the same Shiki highlighting and theme handling as the diff, line numbers and a fixed header with the path and status.
  - **Margin marks:** for changed files, fetch the ChangeFile via `/api/file-diff` and render `changeMarks()` (ticket 34):
    - a bar in the `--add` colour for added lines and in the `--modified` colour for modified lines;
    - a small wedge where lines were deleted;
    - on the before side, the mirrored marks.
  - An overview ruler (reuse `OverviewRuler`) shows the marks for the whole file.
  - `]`/`[` jump to the next/previous change block in the file, and `/` searches the open file with `n`/`N`, reusing the existing search code.
  - Large file: show the truncated part, with a notice and a key/button ("load full file") that refetches with `full=1`.
  - Images preview via `/api/snapshot/raw`, binary files show "binary, N bytes", symlinks show their target, and deleted files show their before content dimmed with a "deleted in this Selection" note.
- [x] Go to file:
  - `ctrl+p` opens a fuzzy finder dialog backed by `/api/snapshot/paths`, debounced, showing status badges.
  - `Enter` opens the file and reveals it in the tree, expanding its ancestors. `Escape` closes.
  - `preventDefault` stops the browser's print dialog.
- [x] Review Marks: `m` on a changed file (in the tree or the code pane) toggles the same Review Mark as in the diff, using the file's contentHash from the Change Set. On unchanged files it does nothing; show a short status hint.
- [x] Entering from the diff: when a file is selected in the review layout, `o` opens Code View with that file open and revealed, scrolled to the new-side line that is at the top of the diff pane (the top line of the side-by-side right column, or the unified new line number). With nothing selected, it starts at the tree root.
- [x] Remembering: expanded folders, the open file and its scroll position are remembered per Snapshot (Selection + side) for the session, in sessionStorage wrapped in try/catch, and restored when toggling back. They reset when the Snapshot changes.
- [x] State: new reducer state and actions in `web/state/` (mode, side, tree expansion/cursor, open file, finder) with table-driven tests. IO goes in a `useSnapshot` hook. Keep `App` composition-only; no file over about 500 lines.
- [x] Tests:
  - Reducer tests.
  - Playwright, on a fixture with a nested repo and a commit Selection:
    - `o` from a selected diff file opens the same file at the right line;
    - margin marks appear on the changed lines;
    - `b` shows the before content;
    - `}`/`{` move between changed files across folders;
    - `ctrl+p` finds and opens an unchanged deep file;
    - a deleted file shows greyed;
    - `m` marks a changed file and the mark shows in the review layout afterwards;
    - Pending shows an untracked file;
    - `o` returns to the review layout unchanged.

  The existing Playwright tests pass unchanged. Run the full `bun test`, `typecheck` and `build`.
