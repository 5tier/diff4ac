# 13: Moving through the diff and search

**What to build:** The Reviewer moves through a large Change Set quickly: keys jump to the next or previous hunk and file, and `/` searches across the whole Change Set, with `n`/`N` to cycle through matches.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Keys jump to the next and previous hunk, and to the next and previous file, across file boundaries
- [ ] `/` opens a search prompt; matches are highlighted across the whole Change Set, not only the visible file
- [ ] `n`/`N` cycle through matches, moving to the right file and scrolling it into view
- [ ] The match count is shown; `Esc` clears the search
- [ ] Bindings come from the keymap and appear in `?` help
- [ ] A Playwright smoke test covers search and hunk jumping
