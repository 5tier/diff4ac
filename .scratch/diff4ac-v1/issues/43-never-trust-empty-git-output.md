# 43: Never trust empty git output by default

**What to build:** Ticket 39 found that Bun 1.4.0-canary.1 can lose a git child's output under load. It added `retryOnEmpty`, but as an opt-in that only 7 call sites use. Every other call still takes an empty successful result at face value.

It happened again on 2026-11-16 during a full-suite run (`test/branches.test.ts`: expected `agent/feature-x`, got `HEAD`). `GitGateway.currentBranch()` (`src/git/gateway.ts`, around line 652) runs `symbolic-ref --short -q HEAD`, which exits 0. With the output lost, `|| "HEAD"` turns that into a detached HEAD. In the app, the branch could briefly show as `HEAD`, and the Base Branch or Selection could be wrong for one refresh.

Make empty output safe by default instead of opt-in.

**Blocked by:** none. Runs after 42 in lane A, since both touch `src/`.

**Status:** done

- [x] Invert the default: for every git call, an exit-0 result with empty stdout is retried once and then fails with `EmptyGitOutputError`, unless the caller passes `emptyOk: true`. Remove `retryOnEmpty` (or keep it only as the internal name).
- [x] Audit every `git.run` / `git.text` / gateway helper call in `src/` and decide, call by call, whether empty output is legitimately possible. List the decisions in the report.
  - Empty is legitimate, e.g.:
    - `status`/`diff`/`ls-files` with nothing to report;
    - `log` of an empty range;
    - `for-each-ref` in a repo without matching refs;
    - `check-ignore` with no matches;
    - `cat-file --batch-check` with empty input.

    These get `emptyOk: true`.
  - Empty is impossible when the command succeeds, e.g.:
    - `rev-parse --show-toplevel`, `--git-common-dir`, `--verify <rev>` and `--show-object-format`;
    - `symbolic-ref` exiting 0;
    - `log -1 <rev>`;
    - `merge-base` exiting 0;
    - `cat-file -s`, `ls-tree` of an existing path, `worktree list`.

    These keep the default.
  - Remove fallbacks that turn empty output into a value, such as `|| "HEAD"` after a successful `symbolic-ref`. A real detached HEAD is signalled by exit 1, which stays `"HEAD"`.
- [x] Detect lost output fast instead of waiting for the timeout. Ticket 39's diagnostics showed the signature: `proc.exited` resolved with exit 0, the process gone, but stdout/stderr never reach EOF. Today that costs the full 8 s timeout before the retry, which exceeds Bun's default 5 s test timeout and makes a request feel stuck (seen again on 2026-11-16: `server-security.test.ts` timed out at 5003 ms under load).
  - Once `proc.exited` has resolved, give the streams a short grace period (e.g. 250–500 ms) to reach EOF. If they don't, treat it as a lost pipe and retry once at once.
  - Keep the 8 s and 30 s timeouts for git processes that are really still running.
  - Log the fast path like the timeout path.
- [x] Test the retry at the gateway level with the fake-git helpers (`test/helpers/git-error-scenarios.ts`):
  - `symbolic-ref` returning empty with exit 0 once, then the branch → the branch;
  - always empty → `EmptyGitOutputError`;
  - an `emptyOk` command returning empty → no retry, no error.
- [x] Add a unit test that walks the `src/` call sites the way `test/layering.test.ts` walks imports. It fails if a `run`/`text` call for a subcommand on an "empty is impossible" list passes `emptyOk: true`, so the audit can't silently erode. Keep it simple; a grep-level check is fine.
- [x] Run plain `bun test` 3 times, typecheck and build. Also run `scripts/stress-git.ts` under a concurrent full `bun test` in the other worktree, and report the retry counts.
