# 11: Rich diff rendering

**What to build:** The Diff becomes pleasant to read. Unified view remains the default, and `s` toggles side-by-side. Code is syntax-highlighted with Shiki, and changed words within modified lines are highlighted. Rendering is virtualised so that large Change Sets stay responsive.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `s` toggles between unified and side-by-side, and the choice persists for the session
- [ ] Syntax highlighting based on file language, falling back to plain text
- [ ] Changed words are highlighted within modified line pairs
- [ ] Diff rendering is virtualised (a Change Set of several thousand lines scrolls smoothly)
- [ ] Highlighting works in both light and dark themes
- [ ] A Playwright smoke test covers the `s` toggle
