# PRD: diff4ac v1

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). Constrained by ADRs [0001](../adr/0001-bun-runtime-instead-of-node.md), [0002](../adr/0002-read-only-never-writes-to-repository.md), [0003](../adr/0003-refresh-on-demand-not-live.md).

## Problem Statement

Coding Agents now produce a large share of the changes in a Repository: many small commits, across several branches and Worktrees, often with uncommitted Pending work left behind. The Reviewer has to answer "what did the Agents actually change, and have I looked at all of it?", but `git diff`/`git log` in a terminal are awkward for that. They show one range at a time, can't easily slice by day or by Agent, mix in Noise like lockfiles, and nothing tracks what the Reviewer has already read. GUI tools are mouse-driven and built around committing rather than reviewing.

## Solution

`diff4ac` is a local, read-only review tool. Running `bunx diff4ac [path]` inside a Repository starts a small Bun server on localhost and opens a lazygit-style, keyboard-driven React SPA in the browser. The Reviewer picks a Selection (Pending, a commit, several commits, a branch, or a Time Window) and narrows it with Filters (file extension, path glob, Noise, Agent). The resulting Change Set is shown as a Net Diff or a Commit Stack. Agent Commits are badged, every Worktree is visible, and Review Marks track per-file progress, lapsing automatically when an Agent changes a reviewed file again. When the Repository changes, the Reviewer is told but the view only updates when they ask.

## User Stories

### Launching

1. As a Reviewer, I want to run `bunx diff4ac` inside a Repository, so that I can start reviewing without any setup.
2. As a Reviewer, I want to pass a path (`bunx diff4ac ../other-repo`), so that I can review a Repository I'm not currently in.
3. As a Reviewer, I want the browser to open automatically on the right URL, so that I don't have to copy anything.
4. As a Reviewer, I want `--no-open` and `--port` options, so that I can control how the session starts.
5. As a Reviewer, I want a clear error if the path isn't inside a git Repository, so that I know why nothing opened.
6. As a Reviewer, I want the server reachable only from my machine and only with the session's token, so that other websites and other users can't read my source code.
7. As a Reviewer, I want Pending changes of the current Worktree as the default Selection on launch, so that I immediately see what an Agent just left behind.

### Worktrees and branches

8. As a Reviewer, I want to see every Worktree of the Repository in a panel, so that I can follow Agents working in parallel.
9. As a Reviewer, I want each Worktree to show its branch and how many Pending files it has, so that I can see at a glance where there's unreviewed work.
10. As a Reviewer, I want to select a Worktree and see its Pending changes, so that I can review uncommitted Agent work anywhere in the Repository.
11. As a Reviewer, I want to see the list of branches, so that I can pick one to review.
12. As a Reviewer, I want selecting a branch to show what it changed since its merge-base with the Base Branch, so that I see what a PR would show.
13. As a Reviewer, I want the Base Branch auto-detected (`origin/HEAD`, otherwise `main`/`master`), so that branch Selections just work.
14. As a Reviewer, I want to override the Base Branch in config, so that repos with unusual trunks still work.

### Commits and Selections

15. As a Reviewer, I want a commit list with message, author, relative date and short hash, so that I can orient myself in history.
16. As a Reviewer, I want Agent Commits marked with a 🤖 badge, so that I can tell Agent work from human work.
17. As a Reviewer, I want to select a single commit and see its diff against its parent, so that I can review one step.
18. As a Reviewer, I want to pick several commits with `Space`, so that I can review an arbitrary set together.
19. As a Reviewer, I want to range-pick commits with `v`, as in lazygit, so that I can select a contiguous run quickly.
20. As a Reviewer, I want Time Window presets ("today", "yesterday", "last 24h"), so that I can review what the Agents did in a period.
21. As a Reviewer, I want a custom Time Window with start and end, so that I can review any span.
22. As a Reviewer, I want Time Windows to use committer date in my local timezone, so that rebased commits appear when they actually landed.
23. As a Reviewer, I want the status bar to always state the current Selection and Filters, so that I never misread what I'm looking at.

### Filters

24. As a Reviewer, I want to tick which file extensions are shown, so that I can focus on, say, only `.ts` files.
25. As a Reviewer, I want to include or exclude paths by glob, so that I can focus on one area of the codebase.
26. As a Reviewer, I want Noise hidden by default, so that I don't waste time on lockfiles, snapshots and build output.
27. As a Reviewer, I want to toggle Noise back on, so that I can check a lockfile when it matters.
28. As a Reviewer, I want to configure what counts as Noise, so that it fits my Repository.
29. As a Reviewer, I want to filter to one Agent's changes, so that I can review each Agent's work separately.
30. As a Reviewer, I want to see how many files a Filter is hiding, so that I don't miss something by accident.

### Viewing the Change Set

31. As a Reviewer, I want contiguous Selections shown as a Net Diff by default, so that I see the end result without churn.
32. As a Reviewer, I want to switch to a Commit Stack, so that I can see intermediate steps, including code written and later reverted.
33. As a Reviewer, I want non-contiguous Selections shown only as a Commit Stack, so that I'm never shown a misleading Net Diff.
34. As a Reviewer, I want a file tree of the Change Set with per-file `+/−` counts, so that I can see the size of each change.
35. As a Reviewer, I want unified diffs by default, so that I can read changes compactly.
36. As a Reviewer, I want to switch to side-by-side with `s`, so that I can compare complex rewrites.
37. As a Reviewer, I want syntax highlighting, so that the code is readable.
38. As a Reviewer, I want changed words highlighted within lines, so that small edits stand out.
39. As a Reviewer, I want renames shown as old path → new path with only the real changes, so that a moved file doesn't look entirely new.
40. As a Reviewer, I want binary files shown as "binary changed" with old and new sizes, so that I know they changed without seeing noise.
41. As a Reviewer, I want before/after previews of changed images, so that I can review visual assets.
42. As a Reviewer, I want very large file diffs (more than about 1,500 changed lines) collapsed until I expand them, so that the UI stays responsive.
43. As a Reviewer, I want to jump between hunks and files with keys, so that I can move through a large Change Set quickly.
44. As a Reviewer, I want to search within the Change Set with `/`, so that I can find a specific identifier.

### Keyboard and layout

45. As a Reviewer, I want a lazygit-like layout (Worktrees, Branches, Commits, Files on the left; Diff on the right), so that it feels familiar.
46. As a Reviewer, I want `1`–`4` to jump to panels, `0` to the Diff, and `Tab` to cycle, so that I never need the mouse.
47. As a Reviewer, I want `j`/`k` navigation and `Enter` to drill in, so that movement matches my muscle memory.
48. As a Reviewer, I want `?` to show all keybindings for the focused panel, so that I can learn the tool.
49. As a Reviewer, I want to override keybindings in config, so that I can adapt them to my habits.

### Review progress

50. As a Reviewer, I want to toggle a Review Mark on a file with `m`, so that I can track what I've reviewed.
51. As a Reviewer, I want reviewed files visibly marked in the file tree, so that I can see what's left.
52. As a Reviewer, I want a "3/11 reviewed" count for the current Change Set, so that I know my progress.
53. As a Reviewer, I want a Review Mark to lapse automatically when the file's content changes, so that I'm never misled into skipping new Agent edits.
54. As a Reviewer, I want Review Marks to persist across sessions, so that I can continue reviewing tomorrow.
55. As a Reviewer, I want Review Marks stored outside the Repository, so that they never show up in git.

### Repository changes during review

56. As a Reviewer, I want a "Repository changed — press r" banner when commits, refs, Worktrees or Pending files change, so that I know Agents are still working.
57. As a Reviewer, I want the view not to change until I press `r`, so that text doesn't jump while I'm reading.
58. As a Reviewer, I want refreshing to keep my Selection, Filters and position where possible, so that I don't lose my place.
59. As a Reviewer, I want Review Marks on changed files to lapse on refresh, so that progress stays honest.

### Configuration

60. As a Reviewer, I want global settings in `~/.diff4ac/config.json`, so that my preferences apply to every Repository.
61. As a Reviewer, I want an optional `.diff4ac.json` in the Repository, so that a team can share Noise globs, Agent patterns and Base Branch.
62. As a Reviewer, I want to extend the Agent detection patterns (trailers, author names/emails), so that new Agents are recognised.
63. As a Reviewer, I want built-in Agent patterns for Claude Code, Codex and Copilot, so that common Agents work out of the box.

## Implementation Decisions

- **Runtime and packaging**: Bun is the runtime (ADR 0001), using `Bun.serve`, `Bun.spawn` and Bun's file watcher. The SPA is React + TypeScript, built ahead of time and bundled into the package. Distributed from the git repo for v1 (`bunx github:…`/`bun link`); no npm publish yet.
- **Read-only (ADR 0002)**: no code path runs a mutating git command. Git is invoked with `--no-optional-locks` so diff4ac doesn't even touch the index lock while Agents work.
- **Git access**: shell out to the `git` CLI and parse machine-readable output (NUL-separated `-z` formats, `--format` with explicit separators, `--numstat`, `--find-renames`). No libgit2/isomorphic-git.
- **Modules** (each a deep module with a small interface):
  - **Git Gateway**: the only place that spawns git. Takes argument lists and returns parsed records; hides quoting, encodings and output parsing.
  - **Repository Model**: lists Worktrees (with branch and Pending count), branches, Base Branch, and commits (with Agent Commit classification). Built on the Git Gateway.
  - **Agent Classifier**: decides whether a commit is an Agent Commit and which Agent, from trailers and author patterns in config.
  - **Change Set Builder**: the core. Input: a Selection plus Filters plus a mode (Net Diff or Commit Stack). Output: a Change Set (files with status, rename info, `+/−` counts, binary flag, hunks; for Commit Stack, grouped per commit). Decides whether the Selection is contiguous and refuses Net Diff when it isn't.
  - **Review Mark Store**: persists marks under `~/.diff4ac/`, keyed by Repository identity + path + new-content hash. Answers "is this file in this Change Set marked?".
  - **Repository Watcher**: watches `.git` (refs, HEAD, index, worktrees) and each Worktree's files, debounces, and emits a single "repository changed" event.
  - **Config Loader**: merges built-in defaults, the global config and the Repository config, with the Repository config taking precedence.
  - **HTTP Server**: serves the SPA, a JSON API and an SSE stream for change events. Binds to `127.0.0.1`, requires a random per-session token, and validates `Host`/`Origin`.
  - **SPA**: panels, keymap, diff renderer (unified/side-by-side, Shiki highlighting, word-level intra-line diff, virtualised rendering for large Change Sets), status bar, refresh banner.
- **API contract (shape)**: read endpoints for Worktrees, branches, commits (with filtering by Time Window and Agent), and the Change Set for a given Selection, Filters and mode; a file-content endpoint for image previews and expanding collapsed files; write endpoints only for Review Marks (which live outside the Repository); one SSE endpoint for repository-changed events.
- **Selection semantics**: branch = merge-base(Base Branch, branch)…tip. Pending = working tree and index vs HEAD for one Worktree. Time Window = commits by committer date in local timezone; never includes Pending.
- **Refresh (ADR 0003)**: SSE only notifies; the SPA re-fetches on `r`.
- **Large diffs**: file diffs over about 1,500 changed lines are returned collapsed and fetched on demand.

## Testing Decisions

- **Good tests** exercise external behaviour through the highest seam and never assert on internals or mock git.
- **Primary seam: the Change Set Builder and Repository Model, driven against fixture Repositories.** Test helpers script real git Repositories in a temp directory with deterministic authors, committer dates, Agent trailers, branches, Worktrees and Pending changes. Tests assert on the resulting Change Sets and commit lists. This covers Selections, Filters, Net Diff vs Commit Stack, contiguity, Time Window boundaries (timezone and committer vs author date), renames, binary files and Agent classification.
- **Review Mark Store** is tested through the same fixtures: mark a file, change its content, and assert the mark lapses.
- **HTTP Server**: a thin set of tests for token, `Host`/`Origin` rejection, and that the API wires through to the Change Set Builder.
- **SPA**: a few Playwright smoke tests for keyboard navigation (panel jumps, `j`/`k`, picking commits, toggling `s`, `m`, `r` with the banner).
- Runner: `bun test`. No prior art yet; this PRD starts the codebase.

## Out of Scope

- Any write to the Repository: staging, discarding, committing, checkout (ADR 0002).
- GitHub/GitLab PR review.
- Reading raw patches from stdin.
- Comments or notes on hunks (the first candidate for v2, as notes a Reviewer hands back to an Agent).
- Multiple Repositories in one session.
- Semantic or AST-level diffs.
- Sharing Review Marks between Reviewers.
- Publishing to npm; single-binary builds.

## Further Notes

- The original request said "Node.js"; ADR 0001 records the switch to Bun.
- Live refresh was deliberately rejected (ADR 0003). Don't "fix" the banner into auto-refresh.
