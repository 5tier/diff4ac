# 07: Time Windows

**What to build:** The Reviewer selects a Time Window ("today", "yesterday", "last 24h", or a custom start and end) and reviews every commit that landed in it. Commits are matched by committer date in the Reviewer's local timezone, so a rebased Agent commit counts when it landed, not when it was first written. Time Windows never include Pending.


This ticket also makes the Commits and Branches panels follow the selected Worktree: when the Reviewer selects a linked Worktree, its history (and therefore any Time Window, commit or branch Selection) is read from that Worktree instead of the one diff4ac was launched in.

**Blocked by:** 06

**Status:** done

- [x] Presets for today, yesterday and last 24h, plus a custom range entry, all usable from the keyboard
- [x] Matching uses committer date in local timezone; author date is ignored
- [x] The resulting Selection follows ticket 06's rules: Net Diff when contiguous, otherwise Commit Stack
- [x] An empty Time Window shows a clear empty state
- [x] Fixture tests cover commits either side of local midnight, and a commit whose author and committer dates fall on different days
- [x] Selecting a Worktree makes the Commits panel list that Worktree's history, and commit, multi-commit, Time Window and branch Selections are built from that Worktree
- [x] The current-branch marker in the Branches panel follows the selected Worktree
- [x] Fixture tests: two Worktrees on different branches show different commit lists and Change Sets
