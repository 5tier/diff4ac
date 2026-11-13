# 07: Time Windows

**What to build:** The Reviewer selects a Time Window ("today", "yesterday", "last 24h", or a custom start and end) and reviews every commit that landed in it. Commits are matched by committer date in the Reviewer's local timezone, so a rebased Agent commit counts when it landed, not when it was first written. Time Windows never include Pending.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Presets for today, yesterday and last 24h, plus a custom range entry, all usable from the keyboard
- [ ] Matching uses committer date in local timezone; author date is ignored
- [ ] The resulting Selection follows ticket 06's rules: Net Diff when contiguous, otherwise Commit Stack
- [ ] An empty Time Window shows a clear empty state
- [ ] Fixture tests cover commits either side of local midnight, and a commit whose author and committer dates fall on different days
