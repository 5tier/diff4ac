# 32: A validated API contract between server and SPA

**What to build:** The HTTP boundary is trusted on both sides:
- In `web/api.ts`, `getJson<T>` casts `response.json()` to `T`, and `setReviewMark` casts its response. A server field rename still type-checks and only fails at runtime somewhere deep in the UI.
- On the server, the review-mark route reads `body as Record<string, unknown>`.

Ticket 28 added `ApiError` with HTTP status, and ticket 25 removed the query casts. This finishes the rest of finding 8 in `.scratch/reviews/architecture-review-2026-11-15.md`. No new dependencies: write small hand-written type guards, not a schema library.

**Blocked by:** 29. It changes `fetchCommits`/`CommitList` (paging), so start from main after 29 is merged.

**Status:** done

- [x] `shared/api-contract.ts`:
  - Hand-written guards for every response type the SPA reads: `ChangeSet` (including `ChangeFile`, `Hunk`, `commitGroups`, `filter`), `CommitList`, `BranchList`, `WorktreeList`, `ConfigInfo`, session, and the review-mark response.
  - A guard for the review-mark request body.
  - Keep them strict on the fields the UI uses, and tolerant of extra fields.
  - One small helper set (`isString`, `isNumber`, `isArrayOf`, `isOptional`, …) shared by all guards; no copy-paste per type.
- [x] SPA: every `fetch*` in `web/api.ts` passes its guard to `getJson`. A response that fails its guard throws `ApiError` with a distinct status-like marker (e.g. `status: 0`, `kind: "contract"`) and a message naming the endpoint and the first failing field path (e.g. `/api/commit: files[3].hunks is not an array`). The UI shows it like any other load error. Remove every `as T` / `as ReviewMarkResponse` cast at the boundary.
- [x] Server: the review-mark route validates the parsed JSON body with the shared request guard instead of casting. A malformed body stays 400 with today's message.
- [x] Contract tests (the main payoff):
  - `test/api-contract.test.ts` starts a fixture server and calls every endpoint across representative Selections: pending with an untracked file, a rename and a binary image; commit; commit-set net and stack; time-window; branch; worktrees; branches; paged commits; config; session; file-diff.
  - It asserts each response passes its guard, so a server-side shape change breaks this test instead of the UI.
  - Unit tests for the guards: a valid sample passes, each required field missing or mistyped fails with the right path.
- [x] Run the full `bun test`, `typecheck` and `build`. Behaviour for valid responses is unchanged; the Playwright suite passes unchanged.
