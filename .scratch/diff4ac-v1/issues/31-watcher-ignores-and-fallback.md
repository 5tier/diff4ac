# 31: Repository watcher that skips ignored trees and never fails silently

**What to build:** `src/repository/watcher.ts` watches every Worktree with `fs.watch(root, { recursive: true })`, including `node_modules`, `dist` and other ignored trees. Ignored paths are filtered only after an event fires (`check-ignore` in `flush`). This hurts in two ways:
- On Linux, recursive watching costs one inotify watch per directory, so a large JS Repository can hit the watch limit or burn CPU. On macOS, FSEvents is one stream per root, so it's cheap there.
- If recursive watching throws, the code silently falls back to watching only the root directory, so nested edits never raise the "Repository changed — press r" banner (story 56). Runtime watcher `error` events are swallowed too.

This is finding 10 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none. Ticket 29 (commit paging) is in progress in the other lane, and ticket 30 (token cookie) is done on its branch. Neither touches the watcher. Stay out of `src/repository/commits.ts`, `src/changeset/commits.ts`, `web/api.ts` and the server auth code.

**Status:** done

- [x] A watch strategy seam: `RepositoryWatcher.start` takes an optional `watchStrategy` / `watchFn` (default: the platform choice below) so tests can inject failures. It's not part of any public CLI flag.
- [x] Platform choice:
  - **macOS and Windows**: keep one recursive watcher per root, since that's native and cheap. Drop events under ignored paths early with a cached ignore matcher for directories already known to be ignored, so `check-ignore` is not re-run for every `node_modules` event. Keep `check-ignore` as the final authority in `flush`.
  - **Linux** (or wherever recursive watching is unavailable or throws): watch each **non-ignored** directory individually.
    - Build the directory set from `git ls-files` directories plus untracked, non-ignored directories, via `git ls-files --others --exclude-standard --directory`, or a walk that asks `check-ignore` once per batch.
    - When a new directory is created, add a watcher for it; when one is removed, drop it.
    - `.git` is never walked as part of a Worktree. The common dir keeps its own watcher, as today.
- [x] No silent degradation:
  - If setting up watchers fails (e.g. `EMFILE`, `ENOSPC`, or a recursive watch is unsupported and the per-directory set exceeds a cap such as 10,000 directories), or a watcher emits `error` at runtime, switch that Worktree to **polling**.
  - Polling runs every 3 s (a named constant): compare a cheap fingerprint, made from `git status --porcelain=v2 -z` output and the `HEAD`/refs state via `for-each-ref`, and call `onChanged` when it differs. It must stay read-only; the gateway already passes `--no-optional-locks`.
  - Expose the mode per Worktree (`"native" | "per-directory" | "polling"`, plus a reason), and surface it as a diagnostic: add it to `/api/config` diagnostics, or a small `watch` field on `/api/session`, whichever fits the existing shapes. The status bar shows a short "watching: polling" hint only when not native. Don't log or show anything in the normal case.
- [x] `stop()` also stops the poll timers and per-directory watchers. Nothing keeps the process alive after `stop()`.
- [x] Tests (temp HOMEs, real fixture repos):
  - Edits under an ignored directory (e.g. `node_modules/x.js` with `.gitignore`) never call `onChanged`. A nested non-ignored edit (`src/deep/a.ts`) does.
  - With the strategy forced to per-directory: a newly created nested directory gets watched, and an edit inside it fires.
  - With the injected watch function throwing `ENOSPC`, the watcher falls back to polling, a nested edit and a new commit both fire within ~2 polls, and the diagnostic reports polling with the reason.
  - A runtime `error` event switches to polling too.
  - `stop()` leaves no timers; the test process exits cleanly.
  - The existing SSE / banner tests (`test/server-events.test.ts`, Playwright) still pass.
  - Run the full `bun test`, `typecheck` and `build`.
