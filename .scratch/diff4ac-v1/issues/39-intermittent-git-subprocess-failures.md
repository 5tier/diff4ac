# 39: Intermittent failures under load (HTTP 500, hangs, empty git output)

**What to build:** Plain `bun test` on main (6a8679e) fails about 1 run in 3 while another suite or Playwright run is active on the machine. When the failing test runs alone it passes 15 of 15 times. Symptoms seen on 2026-11-15, all on main or on branches that didn't touch the code involved:

- `test/api-contract.test.ts` "every JSON endpoint satisfies its guard": `/api/commits?skip=1: HTTP 500` after about 1 s.
- The same test hanging until its 60 s timeout, with no error printed.
- `EBADF: bad file descriptor, recv` in the same test.
- `git rev-parse --show-toplevel` returning empty stdout → `NotAGitRepositoryError` for a valid fixture (`test/mode-changes.test.ts`).
- Earlier: `git cat-file` exiting 141 (SIGPIPE) under load.

The repo uses Bun 1.4.0-canary.1. Some of this may be a Bun bug, but a 500 or a hang from the real server is a product bug either way: the Reviewer's server runs while agents build and test on the same machine.

**Blocked by:** none.

**Status:** done

- [x] Reproduce on demand:
  - Write a stress script (in `scripts/` or `test/stress/`, not part of the default `bun test`) that starts a fixture server and hits the same endpoints concurrently while generating CPU and process load, e.g. a parallel `git` loop or a second suite.
  - Record the failure rate per symptom.
- [x] Make the server say why: on a 500, log the underlying error (git args, exit code, stderr, and whether stdout was empty) to the server's stderr. Never send it to the client beyond today's error body. Find out which call fails for `/api/commits?skip=1`.
- [x] Find the root cause of each symptom and fix it in our code if it is ours. Look at:
  - `runGit` in `src/git/gateway.ts` (lines 239-277): how stdout/stderr are read relative to `proc.exited`, `stdin` handling, `AbortSignal`/timeouts, and the concurrency cap;
  - `cat-file --batch` / `--batch-check` writers in `src/changeset/files.ts`: closing stdin before the reader is done, which would explain the 141 exits;
  - any place that treats empty stdout as a valid answer (`rev-parse --show-toplevel` must never be empty for a real repo; treat empty output with exit 0 as an error, not as "not a repo").
  - Find why a request can hang: add a per-git-call timeout, after which the call fails with a typed error and its process is killed, so a request can't hang forever.
- [x] If a symptom is a Bun bug:
  - Confirm it by running the stress script under a stable Bun release. Use a temp install (e.g. `BUN_INSTALL=<tmp> curl …/install | bash -s bun-v1.3.x`) and don't change the user's `~/.bun`.
  - Add the smallest workaround in `runGit`, e.g. one retry of a read-only git call whose output is empty or whose read failed with EBADF, and log it with a comment linking the evidence.
  - Write down which Bun version is affected in the report.
- [x] Don't touch the tests' expectations: no longer timeouts, no retries in tests, no skips. The api-contract test's timeout goes back to 30 s once the hang is fixed.
- [x] Tests:
  - unit tests for the new error and timeout paths in `runGit`, e.g. a git that exits 0 with empty output for `rev-parse`, and a git call exceeding the timeout, using a fake `git` on `PATH` in a temp dir;
  - the stress script shows 0 failures over e.g. 200 rounds under load.
  - Then run plain `bun test` 3 times while another `bun test` runs concurrently in a second worktree: 3 of 3 pass. Run typecheck and build.
