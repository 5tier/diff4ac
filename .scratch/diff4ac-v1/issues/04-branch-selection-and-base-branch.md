# 04: Branch Selection and Base Branch detection

**What to build:** The Reviewer opens the Branches panel, picks a branch (such as an Agent's `agent/feature-x`), and sees what that branch changed since its merge-base with the Base Branch, i.e. what a PR would show. The Base Branch is detected automatically.

**Blocked by:** 02

**Status:** done

- [x] Branches panel lists local branches, marking the current one
- [x] Selecting a branch shows the Change Set from merge-base(Base Branch, branch) to the branch tip
- [x] Base Branch is detected from `origin/HEAD`, otherwise `main`, otherwise `master`; the status bar shows it
- [x] Selecting the Base Branch itself gives a sensible empty state
- [x] Fixture tests cover a diverged branch (where the Base Branch moved after the fork) and confirm Base Branch changes are excluded
