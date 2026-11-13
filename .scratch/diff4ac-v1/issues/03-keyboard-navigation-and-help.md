# 03: Keyboard navigation and help

**What to build:** The Reviewer can drive the whole UI without a mouse, lazygit-style: `1`–`4` jump to panels, `0` to the Diff, `Tab` cycles, `j`/`k` move, `Enter` drills in, `?` shows the keybindings available in the focused panel. All bindings come from a single keymap definition so they can be overridden later (ticket 08). This ticket also sets up the first Playwright smoke test.

**Blocked by:** 01

**Status:** done

- [x] `1`–`4`, `0` and `Tab` move focus between panels, and the focused panel is visibly highlighted
- [x] `j`/`k` move the cursor in lists and scroll the Diff; `Enter` selects or drills into the item under the cursor
- [x] `?` opens a help overlay listing the bindings for the focused panel; `Esc` closes it
- [x] Every binding is defined in one keymap, and nothing is hard-coded in components
- [x] Playwright is set up, with a smoke test that launches against a fixture Repository and navigates with the keyboard
