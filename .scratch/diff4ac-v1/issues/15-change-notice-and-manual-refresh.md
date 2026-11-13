# 15: Change notice and manual refresh

**What to build:** While the Reviewer reads, Agents keep working. The server watches the Repository (refs, HEAD, index, Worktrees and their files) and pushes a debounced "repository changed" event over SSE. The SPA shows a "Repository changed, press r" banner but never re-renders by itself (ADR 0003). Pressing `r` reloads while keeping the Selection, Filters and position where possible; Review Marks whose content changed lapse at that moment.

**Blocked by:** 05, 14

**Status:** ready-for-agent

- [ ] The server watches git refs, HEAD, the index, the Worktree list and each Worktree's files, and debounces bursts into one event
- [ ] An SSE endpoint delivers change events, using the session token
- [ ] The SPA shows the banner on an event and does not change the displayed Change Set until `r`
- [ ] `r` refetches and keeps the Selection, Filters, focused panel and scroll position where they still exist
- [ ] If the Selection no longer exists (for example, a deleted branch), the SPA falls back to Pending with a notice
- [ ] Review Marks for changed content show as lapsed after refresh
- [ ] Tests: modify a fixture Repository while the server runs and assert one debounced event; a Playwright test covers the banner and `r`
