# 33: Files panel as a folder tree (toggle with T)

**What to build:** The Files panel lists the Change Set's files as a flat list of paths. Agent changes often touch 30+ files across a few folders, so let the Reviewer switch the Files panel between that flat list and a collapsible **folder tree**. Build the tree as a reusable component, because ticket 35 (Code View) will reuse it to browse a whole Snapshot. See `CONTEXT.md` for Snapshot and Code View. This is part of the Code View design agreed on 2026-11-15.

**Blocked by:** none. Ticket 34 (Snapshot API, server only) runs in parallel; don't touch `src/`.

**Status:** done

- [x] A pure tree model in `shared/`, e.g. `shared/folder-tree.ts`:
  - `buildFolderTree(entries)` turns `{ path, …payload }` entries into a sorted tree: folders first, then files, case-insensitive, as an editor would.
  - Single-child folder chains are compacted into one row (`src/server/routes`), as VS Code does.
  - Each folder carries aggregates: file count, `+additions`/`-deletions`, and how many files are reviewed.
  - Helpers flatten the tree into visible rows for given expanded paths, and find a file's row and its ancestors so a file can be revealed.
  - Unit-tested.
- [x] A reusable `web/panels/FolderTree.tsx` component:
  - It renders the visible rows with indentation and an expand/collapse chevron, and takes a row renderer for file rows. The Files panel passes the existing `FileRow` content (status letter, `+/-`, review mark).
  - Folder rows show the aggregates in the same style.
  - It is keyboard-driven through the existing panel cursor model and doesn't own focus. It is presentational; state lives in the reducer.
- [x] Files panel:
  - A new keymap binding `files.toggleTree` on key `T` (shift+t) switches tree and list. It has a View-group toolbar button showing the current mode and is listed in the help overlay.
  - In tree mode:
    - `j`/`k` move over visible rows;
    - `l` (and `Enter` on a folder) expands a folder;
    - `h` collapses a folder, or moves to its parent folder from a file;
    - `Enter` on a file selects it, exactly like today.
  - `m` (Review Mark) and `x` (expand large diff) on a file row behave as today; on a folder row they do nothing.
  - Folders start expanded. Collapsed folders are remembered per Selection for the session.
  - The mode persists in sessionStorage (`diff4ac-files-view`, wrapped in try/catch). The default stays the flat list.
  - Switching mode keeps the selected file selected and visible.
  - Diff-pane `}`/`{` (next/previous file) follow the visible file order of the current mode, and expand a collapsed folder if they land inside it.
  - Commit Stack mode: the tree is built from the same file list the panel shows today. Don't change what is listed, only how.
- [x] Reducer actions for the tree (toggle mode, expand/collapse, cursor over rows) live in `web/state/app-state.ts` and have table-driven reducer tests in the existing style.
- [x] Tests: unit tests for `shared/folder-tree.ts` (sorting, compaction, aggregates, reveal) and the reducer. Playwright: `T` switches to the tree; `h`/`l` collapse and expand; `Enter` opens a file in the diff; `m` marks from the tree; the mode survives a reload. The existing Playwright tests pass unchanged. Run the full `bun test`, `typecheck` and `build`.
