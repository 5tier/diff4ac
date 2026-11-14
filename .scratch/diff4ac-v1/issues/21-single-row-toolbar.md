# 21: Single-row command toolbar

**What to build:** The command toolbar from ticket 20 wraps to 3 rows at 1400px and about 7 rows at 700px, taking diff space. Make it exactly one row at every width.

**Blocked by:** 20

**Status:** done

- [x] The toolbar is one row (no wrapping) at every viewport width. Its height is a single compact button row, about 28px.
- [x] Group labels ("PANELS", "VIEW", …) are replaced by thin vertical separators. The group name moves to the separator's or group's `title`/`aria-label`, so accessibility is unchanged.
- [x] Buttons are compact: smaller padding, short labels kept, and the `<kbd>` chip kept.
- [x] When the row doesn't fit, it scrolls horizontally: no visible scrollbar, edge fades showing more content, and vertical mouse-wheel scrolls it sideways. The page itself never scrolls horizontally.
- [x] When labels would overflow (measured, not a fixed breakpoint), buttons show only their key chip and the label goes into the tooltip and accessible name. Toggles stay visibly pressed and value chips (Agent, Mode) stay visible.
- [x] Playwright checks the toolbar is a single row (height ≤ 32px) at 1400px and 700px, and that clicks still work.
