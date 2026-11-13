# 01: Walking skeleton: Pending diff in the browser

**What to build:** A Reviewer runs `bunx diff4ac [path]` inside a Repository and their browser opens a lazygit-style SPA showing the current Worktree's Pending changes: a file list on the left and a plain unified diff of the selected file on the right. This establishes every layer end to end: the Bun CLI and server, the Git Gateway, the Change Set Builder for Pending, the JSON API, and the React SPA shell. It also creates the fixture-Repository test helper that every later ticket builds on. See PRD sections "Launching" and "Implementation Decisions", and ADRs 0001 and 0002.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `bunx diff4ac` (and `bunx diff4ac <path>`) starts the server and opens the browser; `--port` and `--no-open` work
- [ ] A clear error and non-zero exit when the path is not inside a git Repository
- [ ] Server binds to `127.0.0.1` only, requires a random per-session token, and rejects requests with an unexpected `Host` or `Origin`
- [ ] SPA shows the lazygit-style layout (left column of panels, Diff on the right, status bar) with Pending as the default Selection
- [ ] Pending covers staged and unstaged changes against HEAD; each file shows its `+/−` counts; selecting a file shows its unified diff
- [ ] git is only ever invoked with read-only commands and `--no-optional-locks`, and output is parsed from machine-readable formats
- [ ] A test helper scripts real fixture Repositories in a temp directory (deterministic authors, dates, commits, Pending changes)
- [ ] `bun test` covers the Pending Change Set against fixtures, plus token, `Host` and `Origin` rejection
