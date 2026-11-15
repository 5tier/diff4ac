# 29: Bounded commit history: page the Commits list, don't load all history per request

**What to build:** `listCommits` (`src/repository/commits.ts`) runs `git log --format=<full format with trailers>` over the **entire** history whenever no limit is given, and no caller gives one:
- `/api/commits` (`src/server/routes/repository.ts`) loads all of it on every load and every `r`;
- `resolveSelectedCommits` (`src/changeset/commits.ts`) loads all of it just to look up a few picked hashes and their positions;
- `listCommitsInWindow` loads all of it and then filters in memory, which affects `/api/time-window` and the Time Window file endpoints.

On a long-lived Agent Repository that means seconds and a lot of memory on every request. This is finding 11 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none. Ticket 30 runs in parallel and changes token handling: `web/api.ts` `readToken`/`sessionToken`/events URL, `web/index.html`, `src/server/security.ts`, `src/server/server.ts` auth and `src/server/static.ts`. Stay out of those parts. Adding a parameter to `fetchCommits` in `web/api.ts` is fine.

**Status:** done

- [x] Paged Commits list:
  - `/api/commits` returns at most `COMMIT_PAGE_SIZE` commits (a named constant, 500) plus `hasMore: boolean`, and accepts `skip=<n>` (or a `before=<hash>` cursor; pick one, validate it in `src/server/query.ts`, and reject bad values with 400).
  - The `agent=` filter keeps today's meaning. It is applied per page in memory, as now, so a page may hold fewer than 500 when filtered; `hasMore` still reflects the unfiltered walk.
  - Add the new fields to the types in `shared/types.ts`.
- [x] SPA Commits panel: loads the first page. When the cursor moves to the last loaded row (`j`) and `hasMore` is true, it fetches the next page and appends it without losing cursor, picks or scroll position. Show a final "loading more…" or "… more" row while more remain. `r` (refresh) reloads from page 1 and keeps the existing behaviour of preserving the selection.
- [x] Time Windows:
  - Server: `listCommitsInWindow` asks git only for the window. Use `--since`/`--until` with the window bounds, widened by a safety margin (e.g. 1 day on each side, because git's date cut-off is a traversal heuristic and rebased histories can have out-of-order dates). Then keep the existing exact in-memory filter (`filterCommitsInTimeWindow`) so results are identical to today.
  - SPA: `selectionFromTimeWindow` / the Time Window dialog compute commits from the loaded list. If the window's start is older than the oldest loaded commit and `hasMore` is true, the dialog marks the count as approximate (e.g. "500+"). Choosing the window still asks the server, so the Change Set is always complete.
- [x] Picked commits: `resolveSelectedCommits` no longer runs the full formatted `git log`.
  - Get positions from a cheap hash-only walk (`git rev-list <HEAD or the worktree's branch>`), stopping as soon as all requested hashes are found if that's practical.
  - Get details from one `git log --no-walk=unsorted --format=… <hashes>`.
  - Ordering, contiguity and the `UnknownCommitError` behaviour from ticket 28 must be identical.
- [x] Tests:
  - A fixture with more than one page of commits (use a smaller page size in tests via an option, not 500 real commits): `/api/commits` paging, the `skip` validation (400), `hasMore`, and the agent filter combined with paging.
  - Time-window equivalence: for several windows, including one on a rebased branch with out-of-order commit dates, the new `listCommitsInWindow` equals the old full-history-then-filter result.
  - `resolveSelectedCommits` equivalence against the old implementation for contiguous picks, non-contiguous picks, and picks given out of order.
  - A process/argument check that `/api/commits` passes `-n` (or `--max-count`) to git and that the window query passes `--since`/`--until`.
  - Playwright: in a fixture with more than one page (small page size via a test-only config or env seam), moving down past the last row loads more, and picking a commit from page 2 works.
  - Run the full `bun test`, `typecheck` and `build`.
