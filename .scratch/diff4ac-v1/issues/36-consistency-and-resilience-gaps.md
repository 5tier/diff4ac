# 36: Consistency and resilience gaps (validation, ambiguous blob paths, dead exports, Worktree list, Review Mark growth)

**What to build:** A batch of small fixes from finding 15 of `.scratch/reviews/architecture-review-2026-11-15.md`. Each is small; together they make the API's edges predictable. Behaviour for valid input stays the same unless an item says otherwise.

**Blocked by:** none. Start from branch `ticket-34` (Snapshot API, verified, merging soon), not `main`. Ticket 33 (Files panel tree, `web/`) runs in parallel: don't touch `web/panels`, `web/state` or `web/hooks`.

**Status:** done

- [x] Path validation (`src/paths.ts` `isSafeRelativePath`):
  - Also reject all control characters (`\x00-\x1f`, `\x7f`), including `\r` and `\n`.
  - It is the single path rule for filters, Review Marks, the file and Snapshot endpoints, and git arguments.
  - Remove the `isValidReviewPath` alias in `src/review/marks.ts`; callers use `isSafeRelativePath` directly.
- [x] Branch names:
  - Add `isValidBranchName` in `src/paths.ts` (or a `refs` helper), a conservative check close to `git check-ref-format --branch`:
    - no `..`, `@{`, control characters, space, `~^:?*[\`;
    - no leading `-` or `/`;
    - not ending in `.lock`, `/` or `.`.
  - Use it in `src/server/query.ts` wherever a branch name is accepted (`/api/branch`, a branch Selection), and in `readBranch`. An invalid name gives 400 "invalid branch name". A valid name that doesn't exist stays 404 as today.
- [x] Ambiguous `<rev>:<path>` blob lookups:
  - `src/changeset/files.ts` builds `${rev}:${path}` for `rev-parse` and for the `cat-file --batch-check` lines (around lines 282 and 491). That form is ambiguous or breaks when a path contains `:` or starts with special characters.
  - Resolve blobs through a form that cannot be misread: `git ls-tree -z <rev> -- <path>` for the object id, or the `<rev>:./<path>` form if git's tests show it is unambiguous for all paths. Pick the one that also works inside the batch call, and keep the existing per-file fallback for paths the batch cannot express.
  - Apply the same to `src/snapshot/` content reads.
  - Test with paths containing `:`, a leading `-`, spaces and unicode.
- [x] Worktree list resilience: in `listWorktrees` (`src/repository/worktrees.ts`, the `Promise.all` around line 131), one missing or broken Worktree, e.g. a linked worktree folder deleted by hand, must not fail the whole list.
  - Skip it, or include it with `missing: true` and no pending count. Pick whichever fits the current `WorktreeSummary` shape and the SPA's rendering; if you add a field, update the guard in `shared/api-contract.ts`.
  - The SPA shows such a Worktree greyed if included. Only a minimal Rows tweak is allowed here; coordinate by keeping it to `web/panels/Rows.tsx` `WorktreeRow` styling only.
- [x] Review Mark growth (`src/review/marks.ts`): the marks file grows forever.
  - On server start, prune marks for this Repository whose `(path, contentHash)` no longer matches any file content reachable cheaply: drop marks older than 90 days that are not for a current Pending file.
  - Also cap the store at 5,000 marks per Repository, dropping the oldest first. Store a `markedAt` timestamp if it isn't there yet, and treat missing timestamps as "now" on first load.
  - Write atomically (temp file + rename) if it doesn't already.
- [x] Dead and test-only exports:
  - Remove `defaultReviewMarkDirectory` if unused.
  - `wordDiffSegments` in `shared/diff/rows.ts` is only used by tests: either use it from production code where it belongs, or move it next to the test helper.
  - Turn on `noUnusedLocals` and `noUnusedParameters` in `tsconfig.json` and fix what they flag. Prefix intentionally unused parameters with `_`.
- [x] Key label consistency: the help overlay and the toolbar both display key names from one shared `displayKey` (shared), so `Escape` shows as `Esc` everywhere, with the same for `Enter`, `Tab`, `Space` and arrows. Change only the label source, not the keys.
- [x] Tests for each item:
  - path rejections, including `\n`, `\r` and `\x7f`;
  - branch-name 400 vs 404;
  - colon/dash/space paths through the pending, commit and Snapshot content endpoints;
  - a deleted linked Worktree no longer breaks `/api/worktrees`;
  - Review Mark pruning and cap, and an atomic write;
  - `displayKey` labels.

  Run the full `bun test`, `typecheck` and `build`.
