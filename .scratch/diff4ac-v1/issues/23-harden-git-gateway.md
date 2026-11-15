# 23: Harden the git gateway as the only read-only choke point

**What to build:** ADR 0002 promises diff4ac never writes to the Repository. Today `assertReadOnly` in `src/git/gateway.ts` checks only the subcommand, so allowed subcommands can still take options that write files or run programs. Also, `src/changeset/files.ts:707` calls `runGit` directly to diff the two temp files of a paired rename. That bypasses `GitGateway`. Make `GitGateway` the single entry point and make the guard check options too. This comes from finding 4 and part of finding 5 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none

**Status:** done

- [x] Option guard: `assertReadOnly` rejects these options anywhere in the args, in both the `--opt` and `--opt=value` forms:
  - `--output`
  - `--ext-diff`
  - `--textconv`
  - `--no-index`, which is only allowed through the dedicated no-index method below
  - for `cat-file`: `--textconv` and `--filters`
  - for `log`, `show` and `diff`: `--exec` and `--run`, if git accepts either
- [x] `symbolic-ref` is only allowed in read form: the flags `--short`, `-q` and `--quiet`, plus exactly one ref name. Reject `-d`, `--delete`, `-m`, `--set*`, and any call with two positional args. `git symbolic-ref HEAD refs/heads/x` writes HEAD and is not caught today.
- [x] `diff`, `log` and `show` always run with `--no-ext-diff --no-textconv`. The gateway inserts them right after the subcommand, so callers can't forget them. Callers that already pass `--no-ext-diff` must still work, either by de-duplicating or because git tolerates the repeat; check which.
- [x] Single entry point:
  - `runGit` is no longer exported. Nothing outside `src/git/gateway.ts` spawns git.
  - Add a narrow method for the paired-rename case, e.g. `GitGateway.diffNoIndex(dir, oldRel, newRel, extraArgs)`. It runs `git diff --no-index --no-color --no-ext-diff --no-textconv` with cwd = a temp dir, and refuses a dir inside the worktree root.
  - Move the temp-file creation and cleanup from `files.ts:698-723` into a small helper, e.g. `src/git/temp-diff.ts` or a method that owns the temp dir. Its doc comment states it only writes under `os.tmpdir()`, never the Repository.
- [x] CLI first-use build (`src/cli.ts` `ensureWebBuilt`): if `dist/web/index.html` is missing and `PROJECT_ROOT` is inside the reviewed worktree (`git.worktreeRoot`), don't build. Print `diff4ac: the SPA is not built; run "bun run build" in <PROJECT_ROOT> first` and exit 1. Building stays as it is when diff4ac reviews any other repo.
- [x] Tests:
  - In `test/git-gateway.test.ts`, one test per rejected option and form: `diff --output=x`, `log --output x`, `diff --ext-diff`, `show --textconv`, `diff --no-index` through `run`, `cat-file --textconv`, `symbolic-ref -d HEAD`, `symbolic-ref HEAD refs/heads/x`, `symbolic-ref -m msg HEAD refs/heads/x`. Allowed read forms still work.
  - End-to-end test on a fixture repo: configure `diff.external` and a textconv driver (via `.git/config` + `.git/info/attributes`) pointing to a script that touches a marker file in the temp dir. Open Pending, a Commit and a paired-rename Change Set through the server. Assert the marker file was never created and the diff shows the raw content.
  - A test that no file under `src/` other than `src/git/gateway.ts` imports `runGit` or calls `Bun.spawn` with `git`. A grep-style test is fine.
  - A CLI test: with `PROJECT_ROOT` inside the reviewed repo and no `dist/web`, the CLI exits 1 with the message and creates no files. Use a temp copy or a stubbed path. Keep it fast, and use a temp HOME.
