# 42: Unexpected server errors return a generic message, details go to the log

**What to build:** This is the rest of finding 12 of `.scratch/reviews/architecture-review-2026-11-15.md`. Ticket 28 already mapped expected misses to 404/409/400 with user-facing text. Unexpected failures still send `error.message` to the browser. For a `GitError` that message contains the full git command line and its stderr (`gitApiFailure` and `jsonGitFailure` in `src/server/routes/shared.ts`), which can include absolute paths and object ids. Since ticket 39, the server already logs the details to stderr. Make the response generic and link it to the log line.

**Blocked by:** none. Small; can run after 40 in the same lane, since both touch `src/`.

**Status:** done

- [x] On an unexpected failure (anything not mapped to 4xx), generate a short error id, e.g. 8 hex chars from `crypto.randomUUID()`. Log it with the existing details to stderr.
  - Respond `500` with `{ error: "Internal error (id <id>). See the diff4ac terminal for details." }` for JSON endpoints.
  - Plain-text endpoints get the same text.
  - Keep the response shapes the SPA's guards expect (`shared/api-contract.ts`); update guards and the contract test only if a shape changes.
- [x] Expected misses (404/409/400) keep their current user-facing messages.
- [x] The SPA shows the server's message as it does today. Check that the generic text renders sensibly where errors appear, e.g. the status bar and the Worktrees panel. No other UI change.
- [x] Tests:
  - a forced unexpected `GitError` (e.g. with the fake-git helpers from ticket 39 in `test/helpers/git-error-scenarios.ts`) returns 500 whose body has no git args, no stderr and no absolute path, and contains an id;
  - the same id appears in the captured stderr log line.
  - Run plain `bun test`, typecheck and build.
