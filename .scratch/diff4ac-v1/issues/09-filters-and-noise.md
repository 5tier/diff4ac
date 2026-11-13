# 09: Filters and Noise

**What to build:** The Reviewer narrows the Change Set by file extension (tick boxes) and by path globs (include or exclude). Noise (lockfiles, snapshots, build output) is hidden by default by a configurable Filter, and can be toggled back on. The UI always says how many files are hidden, so nothing is missed by accident.

**Blocked by:** 01, 08

**Status:** ready-for-agent

- [ ] Extension Filter lists the extensions present in the current Change Set, each with a toggle
- [ ] Include and exclude path globs can be entered
- [ ] Noise is hidden by default, using built-in patterns (lockfiles, `*.snap`, `dist/` and similar) that can be overridden in config
- [ ] A key toggles Noise visibility
- [ ] The status bar shows the active Filters and "N files hidden"
- [ ] Filters persist when the Selection changes
- [ ] Fixture tests cover each Filter type and how they combine
