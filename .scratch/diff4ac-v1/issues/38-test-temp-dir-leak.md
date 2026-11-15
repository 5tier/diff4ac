# 38: Test suite leaks temp directories

**What to build:** Each plain `bun test` run leaves about 70 directories in `$TMPDIR` (macOS: `getconf DARWIN_USER_TEMP_DIR`). On 2026-11-15 there were about 12,300 of them, using about 420 MB:

| Prefix | Count |
|---|---|
| `diff4ac-home-` | 4,480 |
| `diff4ac-state-` | 4,033 |
| `diff4ac-fixture-` | 2,994 |
| `diff4ac-web-` | 291 |
| `diff4ac-worktrees-` | 228 |

While they were present, plain main crashed Bun (`Option::unwrap` panic, exit 133). After the stale ones were deleted, main passed 383/383 again.

**Already fixed (ac18d36):** the main cause. `test/helpers/server.ts` registered a module-level `afterEach`, but Bun hooks are file-scoped and the helper module is cached, so only the first importing file cleaned up. Each file now calls `cleanupFixtureServers()`. After that, 3 full runs left 0 temp dirs.

What remains is to make this hard to regress: one cleanup mechanism instead of a per-file call that is easy to forget, and a guard test. Make the suite clean up after itself, including when a test fails or times out.

**Blocked by:** none. Touch `test/` (and `scripts/` if `diff4ac-web-*` comes from a build helper) only; production code is out of scope except `src/git/temp-diff.ts` if it is shown to leak.

**Status:** done

- [x] Find every leak. Creation sites (from `mkdtempSync(join(tmpdir(), …))`):
  - `test/helpers/home.ts` (`diff4ac-home-`)
  - `test/helpers/fixture.ts` (`diff4ac-fixture-`, `diff4ac-worktrees-`)
  - `test/helpers/server.ts`
  - `test/review-marks.test.ts` (`diff4ac-state-`)
  - `test/playwright-smoke.test.ts` (`diff4ac-playwright-state-`, `diff4ac-paging-state-`)
  - `pending-renames`, `file-oriented-change-sets`, `git-read-only`, `git-gateway`, `snapshot-api`, `cli` and `awkward-files` tests
  - whatever creates `diff4ac-web-*`
  - `src/git/temp-diff.ts` (`diff4ac-rename-`): check that it removes its directory on every path, including errors.
- [x] Replace the per-file `cleanupFixtureServers()` calls (and the `repo.dispose` wrapping in `test/helpers/server.ts`) with something a new test file can't forget, e.g. a `bunfig.toml` `[test] preload` that registers one global `afterEach`/`afterAll` for all helpers (preload hooks are global), or disposables (`using`). Keep the rule that servers and watchers stop before their Repository dir is removed.
- [x] One cleanup mechanism: a shared helper in `test/helpers/` that creates a temp dir and registers it for removal in `afterEach`/`afterAll`, or returns a disposable (`using`). All tests use it instead of calling `mkdtempSync` directly. Removal uses `rmSync(…, { recursive: true, force: true })` and must also run when the test throws or times out.
  - `.git` object dirs can be read-only, so make removal robust there.
- [x] Child processes and servers started by tests (diff4ac servers, Chrome via Playwright, `git` subprocesses, watchers) are stopped before their temp dir is removed, in `finally`/`afterEach`, so nothing keeps a handle open.
- [x] A guard test (e.g. `test/temp-dir-leak.test.ts`, or an `afterAll` in a preload) counts `diff4ac-*` entries in `tmpdir()` before and after the suite (or one representative helper-heavy file) and fails if new ones remain. It must not delete or count directories it didn't create, so other runs in parallel lanes don't interfere: tag this run's dirs, e.g. with a per-run prefix segment.
- [x] Don't delete anything outside this run's own temp dirs. Never touch the real `~/.diff4ac`.
- [x] Verification:
  - `ls $TMPDIR | grep -c diff4ac` is the same before and after 3 consecutive plain `bun test` runs (no `--isolate`), on a quiet machine;
  - typecheck and build pass;
  - no test assertion weakened.
