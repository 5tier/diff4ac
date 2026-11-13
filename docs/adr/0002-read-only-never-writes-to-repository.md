# diff4ac never writes to the Repository

diff4ac is strictly read-only towards the Repository: no staging, discarding, committing or checking out. Agents may be working in the same Worktrees at the same moment, and any write from the Reviewer's browser could race with them or destroy their work. Reviewer state (Review Marks, global config) lives under `~/.diff4ac/`. Hunk staging is the most likely feature to be requested; it needs a new ADR that supersedes this one.
