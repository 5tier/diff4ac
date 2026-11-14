# 19: Change overview ruler

**What to build:** Now that the diff panel shows whole files by default, the Reviewer can't see at a glance where the changes are. Add an overview ruler: a narrow vertical strip along the right edge of the diff panel, like an editor's scrollbar markers, with one mark per block of changed lines placed proportionally to its row in the whole diff panel. Additions are green, deletions red, and blocks with both get a mixed or amber colour. A translucent box shows the visible viewport. Clicking a mark, or anywhere on the strip, scrolls the diff panel there. File boundaries show as thin neutral ticks.

**Blocked by:** 13

**Status:** done

- [x] The ruler appears in both unified and side-by-side views, and in both full-file and hunks-only modes
- [x] Marks come from the same row model the diff renders (`buildDiffRows`), so they line up with virtualised rows (`ROW_HEIGHT`) and include every file in the panel, including Commit Stack groups
- [x] Collapsed large diffs, binary files and mode-only changes don't break it (no marks, or one neutral mark)
- [x] The viewport box follows scrolling; clicking scrolls the `.diff-pane`
- [x] Colours use the existing theme tokens and work in light and dark themes
- [x] Pure mark computation lives in `src/diff/` with unit tests; one Playwright check verifies marks render and a click scrolls
