# 08: Configuration

**What to build:** The Reviewer can customise diff4ac with a global `~/.diff4ac/config.json` and an optional `.diff4ac.json` in the Repository, which takes precedence. This ticket delivers loading, merging and validation, with two visible effects: keybinding overrides and a Base Branch override. Later tickets add their own settings (Noise, Agent patterns) to the same config.

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Built-in defaults, then global config, then Repository config are merged, in that order of precedence
- [ ] Invalid config produces a clear message naming the file and the field; the tool still starts with defaults for that field
- [ ] Keymap overrides from config take effect and are reflected in the `?` help overlay
- [ ] A Base Branch override replaces auto-detection
- [ ] diff4ac never writes the Repository config file (ADR 0002)
- [ ] Tests cover merge precedence and invalid config
