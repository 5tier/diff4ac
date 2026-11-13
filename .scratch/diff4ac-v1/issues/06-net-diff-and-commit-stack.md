# 06: Combined and per-commit views over several commits

**What to build:** The Reviewer picks several commits (`Space` to toggle, `v` to start a range, as in lazygit) and reviews them together. For contiguous Selections the default is a Net Diff (one before/after), and a key switches to a Commit Stack (one diff per commit, in order). Non-contiguous Selections are only shown as a Commit Stack, because a Net Diff of commits with gaps between them is misleading.

**Blocked by:** 02

**Status:** done

- [x] `Space` toggles a pick on the commit under the cursor; `v` starts a range pick, extended with `j`/`k`
- [x] A contiguous Selection defaults to Net Diff; a key toggles to Commit Stack and back
- [x] A non-contiguous Selection shows a Commit Stack; the Net Diff toggle is disabled and the UI says why
- [x] The Commit Stack groups the diff by commit, with each commit's message as a header
- [x] The status bar states the mode (Net Diff or Commit Stack)
- [x] Fixture tests cover contiguous vs non-contiguous detection, and a file that is written and then reverted (absent from the Net Diff, visible in the Commit Stack)
