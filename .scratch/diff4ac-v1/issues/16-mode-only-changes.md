# 16: Mode-only changes

**What to build:** A file whose only change is its mode (for example becoming executable, `100644 → 100755`) currently shows just its heading and an empty diff. It should say what changed, so the Reviewer does not think the file is broken or empty.

**Blocked by:** 12

**Status:** done

- [x] Change Files carry old and new mode when git reports a mode change (parsed from `old mode` / `new mode` in the diff header)
- [x] A mode-only change shows "Mode changed: 100644 → 100755 (now executable)" (or "no longer executable") instead of an empty diff
- [x] A mode change together with content changes shows the mode line above the hunks
- [x] Works for Pending, a single commit, Commit Stack and Net Diff; the Files panel marks mode-only files
- [x] Fixture tests cover a mode-only change and a mode-plus-content change
