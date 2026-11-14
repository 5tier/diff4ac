# 20: Command toolbar

**What to build:** Every keyboard command should also be reachable with the mouse. Add a toolbar below the existing `.top-bar` header with one button per action binding. Each button shows a short label plus a `<kbd>` chip with its *effective* key, taken from the merged keymap after config overrides, so a rebound key shows its new key. Clicking a button runs exactly the same action as pressing the key. Buttons are generated from the keymap in `src/keymap.ts` by binding id, not hand-written.

**Blocked by:** 13, 19

**Status:** done

Groups, in this order and separated visually:
- **Panels:** `1` `2` `3` `4` `0` (focus Worktrees, Branches, Commits, Files, Diff)
- **View:** `s` side-by-side, `c` full file, `n` Noise, `f` Filters. Toggles show their on/off state, e.g. pressed or highlighted.
- **Navigate:** `/` search, `[` `]` hunk, `{` `}` file. While a search is active, `n`/`N` next/previous match and `Esc` clear.
- **Review:** `m` Review Mark, `x` load large diff
- **Commits:** `t` Net Diff / Commit Stack (show the current mode), `w` Time Window, `a` Agent filter (show the current Agent), `v` range pick, `Space` pick
- **Repository:** `r` refresh, which is highlighted while the "Repository changed" banner is up
- **Help:** `?`

Left out: plain movement and selection bindings (`j`/`k`, `Enter`, `Tab`), and `Escape`, which only closes dialogs.

- [x] The toolbar renders every listed command from the keymap, showing effective keys (a config override is reflected)
- [x] Clicking runs the same action as the key. A panel-scoped action (Commits group, Review group, hunk/file navigation) acts on the panel it belongs to, the same as pressing the key with that panel focused, and returns focus so keyboard use continues
- [x] Buttons that can't apply right now are disabled with a tooltip saying why (no file selected, nothing collapsed, no search active, …)
- [x] Buttons have accessible names (label plus key); toggles use `aria-pressed`
- [x] The toolbar wraps or scrolls horizontally at narrow widths without breaking the layout, and works in light and dark themes
- [x] Unit tests cover how the toolbar model is built from the keymap (groups, effective keys, override); Playwright checks that clicking `s`, `c` and `t` does the same as the keys
