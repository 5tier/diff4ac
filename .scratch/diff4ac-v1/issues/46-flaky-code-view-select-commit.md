# 46: Flaky Code View test: the picked commit's files never appear under load

**What to build:** `test/playwright-code-view.test.ts` sometimes hangs for 60 s in its `selectCommit` helper. That helper picks a commit and then waits for `.file-row` with `src/alpha.ts` (around line 71, added in ticket 44).

It has failed three times, each time only during a full `bun test` run:
- twice while lane A worked on ticket 44;
- once on 2026-11-16 in "opens at the top new-side line of the reviewed diff" ("waitFor: Target page, context or browser has been closed" after the 60 s test timeout).

Running the file alone on main d76849a passed 10/10.

Find out whether this is a test problem or a real app bug, and fix the cause. A real app bug would be the commit Selection sometimes not loading its Change Set, or loading a stale one, when the server is slow.

**Blocked by:** none.

**Status:** done

- [x] Reproduce it. Run the file under load, e.g. alongside a full `bun test` in another process, or with CPU stress. Collect evidence when it hangs:
  - what the page shows (screenshot);
  - the Selection and Files panel state;
  - which `/api/...` requests were made, their status and timing;
  - the server log.
- [x] Find the cause and say which it is, with evidence:
  - the test reads state too early or picks the wrong row;
  - a request is lost or never retried;
  - the UI keeps a stale Change Set after a slow response (a request race);
  - the shared browser from ticket 41 is closed by another file's cleanup while this file is still running.
- [x] Fix the cause:
  - if the app can end up showing the wrong or no Change Set for a Selection, fix the app and add a test that forces a slow response to show the bug is gone;
  - if it is the test, make it wait on settled state without fixed sleeps or weakened assertions.

  Don't just raise timeouts.
- [x] Run `bun test test/playwright-code-view.test.ts` 20 times while a full `bun test` runs in parallel, and report the pass count. Then run plain `bun test` 3 times, typecheck and build.
