# 18: Negation in Filter globs

**What to build:** Include, exclude and Noise globs accept `.gitignore`-style negation: a pattern starting with `!` re-includes what an earlier pattern matched, and the last matching pattern wins. For example Noise `["dist/**", "!dist/keep.js"]` hides build output except one file.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] In each pattern list, patterns apply in order and the last matching pattern decides; `!pattern` negates; a list with only negations matches nothing
- [ ] `\!` matches a literal leading `!`
- [ ] Same basename/full-path rules as today (no `/` means basename at any depth; a leading `/` anchors at the root)
- [ ] Works in the `f` dialog, the URL parameters and config Noise; the dialog hint mentions `!`
- [ ] Unit tests on the pure Filter module and a fixture server test
