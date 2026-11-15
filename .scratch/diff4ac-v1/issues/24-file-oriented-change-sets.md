# 24: File-oriented, faster Change Set building

**What to build:** Building a Change Set does git work for every file one after another: in `src/changeset/files.ts`, `buildChangeFiles` awaits `diffFor`, `reviewContentHash` (one `rev-parse` per file) and `contentSizeAtRev` in order. `/api/file-content` (image `<img>` requests) and `/api/file-diff` (expanding a collapsed file) rebuild the whole Change Set just to return one file (`src/server/server.ts:620-689`). Full-file mode is the default view, so every Change Set request also asks for whole-file context on every file, although outside Commit Stack mode the SPA renders only the selected file (`web/app.tsx` around line 2342). Make the expensive work file-oriented and batched, without changing what any endpoint returns. This is finding 1 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** 23 (it reshapes `files.ts` and the gateway; start from main after 23 is merged)

**Status:** done

- [x] Batched lookups: content hashes (`blobHashAt`) and binary sizes (`contentSizeAtRev` for commit-backed sides) for a Change Set are resolved with one `git cat-file --batch-check` call, with the `<rev>:<path>` lines on stdin (`GitRunOptions.input`). This replaces one process per file. Missing objects must behave as today (fallback to `diffContentHash`). Paths containing `:` or newlines must not break the batch: fall back to the per-file path for those.
- [x] Per-file diffs run with a concurrency cap (8, as a named constant) instead of strictly in sequence. The output order and content are unchanged, and the files are still sorted by path.
- [x] Single-file endpoints:
  - Add a file-oriented builder, e.g. `buildScopedChangeFile(git, scope, path, rev, options)` in `src/changeset/`. It resolves the scope's range(s) and name-status records the same way the scoped builders do, but runs the per-file work (diff, hash, sizes, paired-rename diff) only for the matching record.
  - The record matches by `path`, and by `rev` for Commit Stack / Time Window groups, with the same semantics as `changeFileFor` in server.ts.
  - Rename detection must still see the whole range, so name-status runs unrestricted and only the per-file diff is restricted to the record's paths.
  - Filters still apply: a file hidden by the request's filters returns 404 as today.
  - `/api/file-content` and `/api/file-diff` use it. `/api/file-content` only needs to confirm that the path and rev belong to the Selection; it doesn't need the diff at all.
- [x] SPA full-file mode outside Commit Stack mode:
  - Change Set list requests (`/api/pending`, `/api/commit`, `/api/commit-set`, `/api/time-window`, `/api/branch`) no longer send `context=full`.
  - When full-file is on, the SPA fetches the selected file with `/api/file-diff?...&context=full`, using `fetchFileDiff`, extended with a fullContext flag. It replaces that file in state, like `expand-diff` does in `web/app.tsx:1813-1838`, and caches it per (file key, rev) until the next refresh or a Selection change.
  - While the full-file version is loading, the hunks-only version is shown; there is no blank flash.
  - Commit Stack mode, which renders every file, keeps requesting `context=full` for the whole set.
  - Toggling `c` still works in both directions without a page reload.
  - Search, the overview ruler and hunk jumping operate on whatever version of the file is shown.
- [x] Equivalence test (the key safety net): for each scope kind (pending with staged, unstaged and untracked files, a paired rename, a binary file and an image; commit; commit-set net and stack; time-window; branch), the output of `buildScopedChangeFile` deep-equals the matching entry from `buildScopedChangeSet`. Also check that the full Change Set output is identical before and after the batching changes; e.g. snapshot the JSON in the test, generated from the same fixture.
- [x] Process-count test: add an optional, test-only spawn counter to the gateway, e.g. a `GitGateway` option or a module-level hook that tests can install. Do not add a public API used by production code. For a fixture commit with 200 changed files, assert:
  - `/api/file-diff` for one file spawns at most ~6 git processes, where today it spawns hundreds;
  - building the Change Set spawns about N (diffs) plus a constant, not 2N or more.
- [x] Playwright: in full-file mode on a multi-file commit, selecting a file shows whole-file content (an unchanged first line is visible), and the network log shows `context=full` only on `/api/file-diff`. In Commit Stack mode everything still renders in full.
