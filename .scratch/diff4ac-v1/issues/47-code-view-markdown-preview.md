# 47: Markdown preview in Code View

**What to build:** when Code View opens a Markdown file (`.md`, `.markdown`), the file pane gets a tab strip: **Code | Preview**. Code is today's highlighted source. Preview renders the file as Markdown. Other files show no tab strip and work as today.

Decisions already made with the user:
- Rendering uses **marked** + **DOMPurify**. These are the only new dependencies. Load them lazily, only when a preview is first shown, the way Shiki grammars are, so `main.js` doesn't grow by more than a few KB.
- The preview's images and links are resolved against the Snapshot that is open.

**Blocked by:** none.

**Status:** done

- [x] Tabs:
  - A Markdown file opens on the Code tab.
  - `p` toggles Code / Preview while the file pane is focused, and clicking a tab does the same.
  - The choice is remembered while you move between Markdown files in the same Code View session, and resets when Code View closes.
  - `b` (after / before Snapshot) keeps the current tab and re-renders from the other side.
  - Add `p` to `shared/keymap.ts` (shown in `?` help) and to the README key table between the `keys` markers.
- [x] Rendering:
  - GitHub-flavoured Markdown: tables, task lists, strikethrough, autolinks, fenced code.
  - Fenced code blocks with a language are highlighted with the existing Shiki setup (`.syntax-token` colours, light / dark / system themes).
  - Sanitise the HTML with DOMPurify before it goes into the DOM. No scripts, event handlers, `javascript:` URLs, iframes, forms or `style` attributes. Raw HTML in the file that survives sanitising (e.g. `<details>`, `<kbd>`, `<img>`) is allowed.
  - Readable typography that follows the theme.
  - The preview scrolls with `j`/`k`, `Ctrl+D`/`Ctrl+U` (or whatever the code pane uses), and the mouse.
  - Files over the `CODE_HIGHLIGHT_LINE_LIMIT` show a short "too large to preview" note instead of rendering.
- [x] Images:
  - Relative image paths, resolved against the Markdown file's folder (`./`, `../`, `/` = repo root), load from `/api/snapshot/raw` for the same Snapshot and side.
  - Paths that leave the repo, and remote (`http:`, `https:`, protocol-relative) images, are not loaded. Show the alt text instead.
  - Don't loosen the CSP in `src/server/http.ts`.
- [x] Links:
  - A relative link to a file in the Snapshot opens that file in Code View (Markdown files on the Preview tab).
  - `#anchor` links scroll within the preview (headings get ids).
  - `http(s):` and `mailto:` links open in a new browser tab with `rel="noopener noreferrer"`.
  - All other schemes are dropped.
- [x] Search (`/`) keeps working on the Code tab. On the Preview tab it either searches the rendered text or switches to Code. Pick one and say which.
- [x] Tests:
  - unit tests for path resolution (relative, `..`, root, escaping the repo, remote) and for sanitising (`<script>`, `onerror=`, `javascript:` links stripped);
  - a Playwright test: open a `.md` with a table, a code block, a relative image and a relative link; press `p`; check the rendered table, highlighted code, the image loaded from `/api/snapshot/raw`, and that clicking the link opens the target file. Also check `b` keeps the Preview tab.
- [x] `bun test`, typecheck and build pass. Report the gzipped size of `main.js` before and after, and the size of the lazily loaded preview chunk.
