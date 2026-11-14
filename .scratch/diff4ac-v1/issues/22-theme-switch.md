# 22: Theme switch

**What to build:** Today diff4ac only follows the OS colour scheme (`@media (prefers-color-scheme: light)` in web/styles.css, plus Shiki dual themes using `--shiki-light`/`--shiki-dark` around line 820). Add a theme setting with three values: `system` (default, current behaviour), `light` and `dark`. A Theme command cycles system → light → dark, on key `D` (shift+d; lowercase `d` is unused but leave it free). It's a keymap binding `global.cycleTheme` and a View-group button in the command toolbar showing its current value. The button stays visible in key-only mode, like the Agent value chip.

**Blocked by:** 20, 21

**Status:** done

- [x] CSS: the light token set applies under `:root[data-theme="light"]` and under `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) }`. Dark is the base `:root`, so an explicit `data-theme="dark"` must win over a light OS. The same applies to every other light/dark rule, including the Shiki colour rules and the `prefers-color-scheme: dark` block at the end of styles.css.
- [x] `color-scheme` (CSS property and meta) matches the effective theme, so scrollbars and form controls follow it.
- [x] The choice persists in localStorage (wrapped in try/catch, like the existing sessionStorage use) and survives reloads and new tabs. If storage is unavailable it falls back to system.
- [x] No flash of the wrong theme on load: apply `data-theme` before first paint. A tiny inline script is not allowed under the CSP `script-src 'self'`, so do it in a small external script loaded synchronously in `<head>` from web/index.html, or by another CSP-safe means.
- [x] Config: an optional top-level `"theme": "system" | "light" | "dark"` in `~/.diff4ac/config.json` / `.diff4ac.json` sets the default when nothing is stored. Invalid values give a config diagnostic and fall back to `system`. It is exposed via `/api/config`.
- [x] Tests: unit tests for the config field (valid, invalid, missing) and the toolbar item. Playwright checks that `D` and the button cycle the theme, that `data-theme` and the computed `--bg` change, that it persists across reload, and that `dark` wins over an emulated light colour scheme.
