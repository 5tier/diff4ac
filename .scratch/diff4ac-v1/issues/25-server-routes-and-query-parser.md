# 25: Split the server into route modules with one typed query parser

**What to build:** `src/server/server.ts` (951 lines) is a router built as one long if-chain in `handleRequest` (`:528-872`) with ten near-identical try/catch blocks. It validates the same concepts in several places:
- commit hashes: `isValidCommitHash` `:175`, plus inline regexes in `/api/commit` and `/api/commit-set`;
- the Change View mode, in `parseScope` and again in `/api/commit-set` and `/api/time-window`;
- `/api/time-window` re-implements `parseScope`'s time-window branch.

This is a **pure refactor: no change to any endpoint's behaviour, status codes or JSON**. This is finding 3 of `.scratch/reviews/architecture-review-2026-11-15.md`, plus the server-test part of finding 13.

**Blocked by:** none (runs in parallel with 26, which only touches `web/`; don't edit `web/`)

**Status:** done

- [x] One query parser: `src/server/query.ts` exports typed parsers that return a result object (`{ ok: true, value } | { ok: false, status, message }`), not throw. At minimum:
  - `parseScope(url)`, the existing one, moved here;
  - `parseFilterSettings`;
  - `parseCommitHash`, `parseChangeViewMode` (no `as ChangeViewMode` casts) and `parseTimeWindowRequest`;
  - `wantsFullContext`;
  - path/rev params for the file endpoints, capturing `rev` in a narrowed local so the `rev as string` cast goes away.

  Every endpoint uses these. The inline hash regexes and repeated mode checks are deleted. `/api/commit`, `/api/commit-set` and `/api/time-window` build their scope through `parseScope`, or through one shared helper for the non-`selection=` URL shape they accept today. Keep the exact accepted URL shapes and error messages.
- [x] Route table: `handleRequest` becomes a small dispatcher over a table of `{ method?, path, handler }`. Handlers live in `src/server/routes/`, grouped by concern, for example:
  - `change-sets.ts`: pending, commit, commit-set, time-window, branch
  - `files.ts`: file-diff, file-content
  - `repository.ts`: worktrees, branches, commits
  - `review.ts`: review-mark
  - `session.ts`: session, config, events
  - static assets and index stay in `static.ts`

  Token/Host/Origin checks stay in front of every route exactly as now (`src/server/security.ts`).
- [x] One error wrapper: something like `withGit(context, url, (git) => …)` centralises `gitForRequest`, `reviewJson`/annotation, and `gitApiFailure`. No route repeats the try/catch.
- [x] `server.ts` keeps `startServer`, the `RequestContext` setup, the event hub and the wiring, and ends up under ~250 lines. No route module exceeds ~200 lines.
- [x] Tests:
  - Unit tests for `query.ts` cover every parser: valid input, each rejection, and the exact message/status.
  - Add `test/helpers/server.ts` (`startFixtureServer`, `getJson`, automatic cleanup with temp HOME) and use it in `server-filters`, `server-security`, `server-events` and `server-worktrees`, plus the other suites that start a server where it fits, removing the duplicated `afterEach` scaffolding.
  - All existing server tests pass **without changing their assertions**; only their setup may change.
  - Run `bun test`, `typecheck` and `build`.
