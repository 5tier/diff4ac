# 05: Worktrees panel

**What to build:** The Reviewer sees every Worktree of the Repository (the main checkout and any linked `git worktree`s that Agents are working in), each with its branch and Pending file count. Selecting a Worktree shows its Pending changes.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Worktrees panel lists all Worktrees with path, branch (or detached HEAD) and Pending count
- [ ] Selecting a Worktree makes its Pending changes the Selection
- [ ] Works when diff4ac is launched from inside a linked Worktree, not only from the main checkout
- [ ] Fixture tests create linked Worktrees with differing Pending changes and assert on each one
