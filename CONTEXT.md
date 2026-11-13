# diff4ac

A read-only, keyboard-driven tool for a human to review code changes that coding agents made in a git repository.

## Language

### People and places

**Reviewer**:
The human who inspects changes in diff4ac. diff4ac never changes the repository on the Reviewer's behalf.
_Avoid_: User, developer

**Agent**:
A coding agent (for example Claude Code or Codex) that writes the changes the Reviewer inspects.
_Avoid_: Bot, AI, assistant

**Agent Commit**:
A commit recognised as written by an Agent, via commit trailers or author patterns. Every other commit is a human commit.
_Avoid_: Bot commit, AI commit

**Repository**:
The single git repository a diff4ac session is launched in, including all of its worktrees.
_Avoid_: Project, repo (in docs)

**Worktree**:
One checkout of the Repository (main or linked via `git worktree`). Each has its own branch and its own Pending changes.

**Base Branch**:
The branch other branches are compared against (auto-detected, normally `main`); a branch's changes are measured from its merge-base with it.
_Avoid_: Trunk, master, target

### What is being reviewed

**Selection**:
Which commits (or uncommitted changes) the Reviewer is looking at: Pending, a single commit, several picked commits, a branch, or a Time Window.
_Avoid_: Range, scope, query

**Pending**:
The uncommitted changes (staged and unstaged) in a Worktree, relative to its HEAD.
_Avoid_: Working copy, WIP, dirty changes

**Time Window**:
A Selection of all commits whose committer date falls in a span of time, interpreted in the Reviewer's local timezone. Never includes Pending.
_Avoid_: Day view, period

**Filter**:
A rule that narrows which files appear, independent of the Selection: by file extension, path glob, or Noise.

**Noise**:
Files a Reviewer usually doesn't want to read (lockfiles, snapshots, build output), hidden by a default Filter.
_Avoid_: Junk, generated files

**Change Set**:
The files and hunks produced by applying Filters to a Selection; the thing actually displayed.
_Avoid_: Diff (when meaning the whole set), view, patch

**Net Diff**:
A Change Set shown as a single before/after across a contiguous Selection, hiding intermediate steps. Not available for non-contiguous Selections.
_Avoid_: Squashed diff, combined diff

**Commit Stack**:
A Change Set shown as one diff per commit, in order, exposing intermediate churn.
_Avoid_: History view, per-commit view

### Review progress

**Review Mark**:
The Reviewer's note that a file's specific new content has been reviewed; it lapses automatically when that content changes. Stored outside the Repository.
_Avoid_: Viewed, approved, checked
