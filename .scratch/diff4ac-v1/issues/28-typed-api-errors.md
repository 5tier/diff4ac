# 28: Typed git errors: expected misses become 404/400, not 500

**What to build:** `gitApiFailure` in `src/server/routes/shared.ts` maps only `UnknownWorktreeError` and `UnknownBranchError` (both 404) and `NonContiguousNetDiffError` (400) to meaningful statuses. Every other `GitError` becomes a 500 with raw git stderr. Examples:
- `GET /api/commit?hash=deadbeef`, a well-formed hash that doesn't exist, gives 500 `{"error":"git log --no-ext-diff … failed with exit code 128 …"}`;
- a branch with no merge-base with the Base Branch gives 500.

The SPA's stale-Selection fallback ("Selection no longer exists — showing Pending") only fires on 404. It detects that by string-matching `"404:"` in the error message (`web/state/selection.ts` `isNotFoundError`, used in `web/hooks/useChangeSet.ts`). So a commit that was rewritten away (amend or rebase by an Agent, which is common) shows a raw git error instead of recovering. This is finding 12, plus the error part of finding 8, in `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none. Ticket 27 runs in parallel and moves files into a new `shared/` directory and between `src/changeset/files.ts`, `src/repository/status.ts` and `src/changeset/totals.ts`. Don't move or rename files or touch the import structure. Keep your edits to error types, the repository/changeset functions that raise them, `src/server/routes/shared.ts`, `web/api.ts` and `isNotFoundError`.

**Status:** done

- [x] Typed errors, raised at the repository/changeset boundary where git output is interpreted (not in the server):
  - `UnknownCommitError(hash)` when a requested commit/revision does not resolve. This covers single commit, commit-set hashes, and `/api/file-diff`/`/api/file-content` revs that name a commit. Detect it by resolving the requested hashes up front with `git rev-parse --verify --quiet <hash>^{commit}`, or `cat-file -e`, which only needs one call for all of them via `--batch-check`. Don't parse stderr text.
  - `NoMergeBaseError(branch, base)` when `merge-base` exits 1 for a branch Change Set (`src/changeset/branch.ts`).
  - Unknown Base Branch: if the configured base branch doesn't exist, raise a typed error too, e.g. reuse `UnknownBranchError` with a clear message.
- [x] `gitApiFailure` mapping, with user-facing messages and no git command lines or stderr for these cases:
  - `UnknownCommitError` → 404 `commit <short> was not found in this Repository`;
  - `NoMergeBaseError` → 409 (or 400) `branch <b> shares no history with <base>`.

  Unexpected `GitError`s stay 500. Keep the existing JSON-vs-text body shapes per endpoint exactly as they are now.
- [x] SPA:
  - `web/api.ts` throws an `ApiError extends Error` carrying `status` (and the server message) from `getJson` and the review-mark POST. The message text the UI shows stays the same as today.
  - `isNotFoundError` becomes `reason instanceof ApiError && reason.status === 404`.
  - Nothing else in `web/` depends on message prefixes. Grep for `"404:"`, `startsWith("4`, etc.
- [x] Tests:
  - Server tests: nonexistent well-formed hash on `/api/commit`, on `/api/commit-set` (one of several hashes) and on `/api/file-diff` with a commit Selection → 404 with the message and no "git " or "exit code" in the body. A branch with unrelated history (an orphan branch in the fixture) → the chosen status and message. A malformed hash is still 400 as today.
  - Playwright: select a commit, then rewrite it away in the fixture (`git commit --amend` in the test via the fixture helper, which is test setup and not diff4ac) and press `r`. The UI falls back to Pending with the existing "no longer exists" message instead of an error.
  - Run `bun test` (the full suite), `typecheck` and `build`.
