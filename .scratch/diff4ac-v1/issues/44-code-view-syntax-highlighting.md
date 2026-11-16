# 44: Syntax highlighting in the Code View

**What to build:** The Code View (ticket 35, `o`) is meant to show whole files with syntax highlighting, like the diff view. It already runs Shiki through `web/highlight.ts` (`useCodeTokens` in `web/panels/CodePane.tsx`), but every file shows as plain text.

Cause: Shiki runs with `defaultColor: false`, so each token only carries the `--shiki-light` / `--shiki-dark` CSS variables. The diff view turns these into a colour through the `.diff-token` class in `web/styles.css` (around line 893), including the light/dark theme rules. The Code View's token spans (`CodePane.tsx`, around line 393) set the variables but have no class, so no colour is applied. Checked on 2026-11-16 against `src/cli.ts` and a Markdown file: 0 coloured spans.

**Blocked by:** none.

**Status:** done

- [x] Code View tokens get their colour from the same theme rules as the diff view, in light, dark and system theme. Prefer one shared class (rename `.diff-token` to something like `.syntax-token` and use it in both views) over duplicated CSS.
- [x] Keep highlighting while a search is active. Today `CodePane` drops the tokens whenever `searchMatches` is non-empty and renders plain segments. Overlay the search-match and current-match marks on the coloured tokens instead, the way the diff view does with `highlightSegments` in `web/DiffView.tsx`. Reuse that code if it fits; don't duplicate it.
- [x] The existing Code View line classes still show: added/changed line backgrounds, deletion gaps, the current line, and Review Mark state.
- [x] Files with no known language, binary files and images behave as today. Plain text renders at once and the colours arrive when Shiki is done, without the pane jumping or losing its scroll position.
- [x] Large files: measure the time to first coloured paint on a big file (e.g. a 5,000-line `.ts` file). If highlighting a large file blocks the UI noticeably, add a size cap like the diff view's, or highlight in chunks, and say which in the report.
- [x] While you're in this pane: opening an added file in the Code View logs a console 404 from `/api/snapshot/file?...&side=before&path=<added file>` (the before side doesn't exist). Don't request a side the Change File says doesn't exist, or treat that 404 as expected without logging an error. No visible UI change.
- [x] Tests:
  - a Playwright test in `test/playwright-code-view.test.ts` that opens a `.ts` file in the Code View and checks that token spans have at least two different computed colours, in both light and dark theme;
  - the same with an active search: the colours stay and the match marks still show;
  - no console errors when opening an added file.
  - Use the helpers in `test/helpers/browser.ts`; no fixed sleeps.
- [x] Run plain `bun test` 3 times, typecheck and build.
