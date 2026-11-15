# 27: An explicit shared layer and no duplicated metadata

**What to build:** There is no boundary between server code, browser code and code used by both. `web/` imports straight from `src/`: `types`, `diff/{rows,navigation,search,overview,mode}`, `toolbar`, `time-windows`, `keymap` and `changeset/selection`. Some of those modules are browser-only but live under `src/`. Metadata is duplicated:
- `isTheme` is defined in `src/config/loader.ts` and `web/theme.ts`;
- `modeLabel` is defined in `src/toolbar.ts` and in the web selection helpers;
- `src/toolbar.ts` hard-codes binding ids that must match `src/keymap.ts`;
- `lineSimilarity` exists in both `src/changeset/rename-pairing.ts` and `src/diff/word-diff.ts`, with different meanings.

The layering around `src/changeset/files.ts` is also inverted: `src/repository/worktrees.ts` imports `countPendingFiles` from it, and `src/filters.ts` imports `changeSetTotals` from it.

This is a **pure refactor: no behaviour change**. This is fix 5, i.e. finding 7 and the layering part of finding 6, in `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none. Ticket 28 runs in parallel and changes error handling in `src/repository/*`, `src/changeset/branch.ts`, `src/server/routes/shared.ts` and `web/api.ts`. Don't change error handling. Moving files and fixing imports is fine, and keep it to import lines in those files.

**Status:** done

- [x] Create a top-level `shared/` directory for code that is pure (no Bun/node APIs, no DOM) and used by both sides. Move into it, keeping the folder structure:
  - `src/types.ts`
  - `src/keymap.ts`
  - `src/toolbar.ts`
  - `src/time-windows.ts`
  - `src/changeset/selection.ts`
  - `src/diff/{rows,navigation,search,overview,mode,word-diff}.ts`, plus whatever they import that is also pure (e.g. `pairing.ts`)

  Update every import in `src/`, `web/`, `test/` and `scripts/`, and add `shared` to tsconfig `include`. Do not leave re-export shims behind; `web/keymap.ts` re-exporting `src/keymap` goes.
- [x] Layer rule, enforced by a test (`test/layering.test.ts`, grep-style over import specifiers):
  - `shared/` imports only `shared/` (and type-only npm packages if any);
  - `src/` imports `src/` and `shared/`, never `web/`;
  - `web/` imports `web/` and `shared/`, never `src/`.

  Write the rule down in a short `docs/architecture.md`: layers, dependency direction, where the read-only git gateway sits, and the server → changeset → repository → git flow. Keep it to one page. `CONTEXT.md` stays a glossary; don't put this there.
- [x] One definition each:
  - `isTheme` and the `Theme` type live in `shared/`, used by the config loader and `web/theme.ts`;
  - `modeLabel` lives once in `shared/`.
- [x] Toolbar metadata comes from the keymap: give `KeyBinding` optional `toolbarGroup` / `shortLabel` / `order` fields, or similar, and derive `TOOLBAR_GROUPS` from them. Delete the hard-coded binding-id lists in toolbar.ts. The toolbar renders exactly the same buttons in the same order; the existing `test/command-toolbar.test.ts` assertions stay unchanged.
- [x] Rename `lineSimilarity` in `rename-pairing.ts` to `renameLineSimilarity`, and the word-diff one to `tokenSimilarity` or similar, if it is exported. Update the call sites and tests.
- [x] Fix the inverted layering:
  - `parseStatusEntries`/`parseUntracked`/`parseUnstagedDeletions`/`countPendingFiles` move to `src/repository/status.ts`;
  - `changeSetTotals` moves to `src/changeset/totals.ts`;
  - `worktrees.ts` and `filters.ts` import from those, not from `files.ts`.
- [x] Tests:
  - the layering test above;
  - all existing tests pass with only import-path changes, and no assertions change;
  - run `bun test` (the full suite, including Playwright), `typecheck` and `build`.
