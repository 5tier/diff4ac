# 34: Snapshot API: folder listing, file content and path search at a Selection's before/after state

**What to build:** Server side of **Code View** (see `CONTEXT.md`: Snapshot, Code View). Code View browses the whole Repository, not only changed files, at the Snapshot that belongs to the current Selection, with the Selection's changes marked. This ticket adds read-only endpoints for that. Ticket 35 builds the UI on top of them.

Which Snapshot (agreed design):

| Selection | after | before |
|---|---|---|
| Pending | the Worktree on disk, including untracked non-ignored files | `HEAD`, or the empty tree when there are no commits |
| single commit | that commit | its first parent, or the empty tree for a root commit |
| picked commits / Time Window (net or stack) | the newest selected commit | the first parent of the oldest selected commit |
| branch | the branch tip | the merge-base with the Base Branch |

The client never passes a revision. It passes the usual Selection params plus `side=after|before`, and the server resolves the revision from the Selection. This reuses `parseScope` / the scope resolvers in `src/changeset/scope.ts`.

**Blocked by:** none. Ticket 33 (Files panel tree, `web/` only) runs in parallel; don't touch `web/` beyond `web/api.ts` additions.

**Status:** done

- [x] Snapshot resolution:
  - `src/snapshot/` (new) resolves `(scope, side)` to either `{ kind: "commit", rev }` or `{ kind: "worktree", root }`, following the table above.
  - It also builds the change index for marking: path → status (added/modified/deleted/renamed with oldPath). Build it from the Selection's name-status records only, which is cheap and needs no per-file diffs. The paths are relative to the Snapshot.
- [x] `GET /api/snapshot/tree?<selection>&side=…&dir=<relative dir or empty>` returns the **immediate children** of one folder, so loading is lazy and big repos stay fast. Each child is:

  ```
  { name, path, kind: "dir" | "file" | "symlink" | "submodule",
    status?: "added" | "modified" | "deleted" | "renamed",
    oldPath?, renamedTo?, containsChanges?: boolean, noise?: boolean }
  ```

  - **Commit Snapshots:** `git ls-tree -z <rev> -- <dir>/`. Add `ls-tree` to the gateway's `READ_ONLY_SUBCOMMANDS`, with a test that rejects nothing else new.
  - **Worktree Snapshots:**
    - list via `git ls-files -z` plus `git ls-files --others --exclude-standard -z`, filtered to the folder;
    - read nothing outside the worktree root;
    - don't follow symlinks; a symlink is listed as `symlink`.
  - **Files deleted by the Selection** appear in their old folder with `status: "deleted"` on the after side.
  - **Renames:** the old path appears as deleted with `renamedTo` set.
  - **Folders:** `containsChanges` is true when any descendant is in the change index. `noise` uses the configured Noise patterns. Filters never hide entries; that was agreed.
  - **Sorting:** folders first, case-insensitive.
  - **Errors:** an unsafe or missing `dir` gives 400 or 404.
- [x] `GET /api/snapshot/file?<selection>&side=…&path=…[&full=1]` returns JSON:

  ```
  { path, kind, size, binary, image, text?, truncated?, totalLines?, status?, deleted? }
  ```

  - **Text:** capped at 1 MB or 20,000 lines unless `full=1`, which has a hard ceiling (e.g. 20 MB → 413).
  - **Deleted files on the after side:** return the before-side content with `deleted: true`.
  - **Symlinks:** return the link target as text (git semantics).
  - **Submodules:** return a small descriptor.
  - **Content source:**
    - commit Snapshots via `cat-file --batch` / `readContentAtRev` (reuse what exists);
    - worktree Snapshots by reading the file from disk under the root. Use `lstat` and refuse anything that resolves outside the root.
- [x] `GET /api/snapshot/raw?<selection>&side=…&path=…` serves image bytes with the right content type, through the same path as the existing image responses (`imageContentType`, the SVG sandbox headers). Non-images give 404.
- [x] `GET /api/snapshot/paths?<selection>&side=…&q=<query>&limit=50` serves fuzzy go-to-file (Code View's `ctrl+p`).
  - It searches all file paths in the Snapshot server-side with a small pure fuzzy scorer in `shared/` (subsequence match, with a bonus for basename, consecutive characters and the start of a path segment). It returns the best matches with `status`.
  - The listing for a commit is cached per resolved rev, using `git ls-tree -r -z --name-only`. Worktree Snapshots are not cached.
- [x] Validation and contract:
  - All params go through `src/server/query.ts` parsers: `side`, `dir`/`path` via `isSafeRelativePath`, `q` length cap, `limit` 1..200.
  - New routes live in `src/server/routes/snapshot.ts` and use `withGit`. Typed errors map as elsewhere: unknown commit → 404.
  - Response guards go in `shared/api-contract.ts` and are added to `test/api-contract.test.ts`.
  - Add `fetchSnapshotTree`, `fetchSnapshotFile`, `snapshotRawUrl` and `searchSnapshotPaths` to `web/api.ts`, with guards. There is no UI in this ticket.
- [x] Changed-line marks: a pure `shared/diff/change-marks.ts` function, `changeMarks(hunks): { added: LineRange[], modified: LineRange[], deletedAfter: number[] }`, computed on **new-side** line numbers of a ChangeFile's hunks:
  - **added:** `+` lines with no paired `-` lines;
  - **modified:** `+` lines that replace `-` lines within the same change block;
  - **deletedAfter:** the new-side line after which lines were removed.

  The UI will fetch the file's diff via the existing `/api/file-diff` and apply this. Unit-test it, including the before side: for `side=before`, mirror it on old-side line numbers (removed / modified / addedAfter).
- [x] Read-only and safety:
  - Everything goes through `GitGateway`, and disk reads only touch files under a Worktree root.
  - Tests confirm a `../` path, an absolute path, and a symlink pointing outside the repo are all refused or not followed, and that the Repository's `git status` is unchanged after every endpoint.
- [x] Tests (fixture repos, temp HOMEs), for every Selection kind and both sides:
  - the root listing;
  - a nested folder;
  - `containsChanges` propagation;
  - deleted and renamed entries;
  - untracked files in Pending;
  - root commit before-side = empty tree;
  - file content of text, binary, image, a truncated large file and `full=1`;
  - the paths search ranking;
  - 400/404 cases.

  Run the full `bun test`, `typecheck` and `build`.
