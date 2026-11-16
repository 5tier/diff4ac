# 40: Split `src/changeset/files.ts` into parse, content, file-diff and assembler modules

**What to build:** This is the rest of finding 6 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Already done:**
- `changeset/totals.ts` and `repository/status.ts` exist;
- `filters.ts` and `worktrees.ts` no longer import `files.ts`.

**What remains:** `src/changeset/files.ts` has grown to 1,063 lines and still mixes several jobs:
- git output parsers;
- image types;
- object format and blob hashing;
- index and worktree modes;
- batched blob lookup;
- content reads and sizes;
- review content hashes;
- per-file diffs and paired-rename diffs;
- the Change Set assembler.

Ten modules import it, including `src/snapshot/` and the server routes. Split it so each module has one job and a small interface. Behaviour, output and the public functions' signatures stay the same.

**Blocked by:** none. Ticket 41 (Playwright split, `test/` only) runs in parallel. Don't touch `test/playwright-*.test.ts`.

**Status:** done

- [x] Target layout (adjust the names if a better seam shows up, and say why in the report):
  - `changeset/parse.ts`: the pure parsers `parseNameStatus`, `parseNumstat`, `parseHunks`, `looksBinary`, `countDiffLines`, `statusFromCode`, and the `FileStatusRecord`/`NumstatRecord` types. No IO; it imports nothing from `src/git`.
  - `changeset/objects.ts` (or `content.ts`):
    - `objectFormat`, `emptyTreeRef`, `gitBlobHash`, and the blob lookup (`resolveBlobInfo`, the batch-check, `blobHashAt`, `gitBlobContent`, `gitBlobSize`);
    - `readContentAtRev`, `contentSizeAtRev`;
    - index and worktree mode helpers, `worktreeFilePath`.
  - `changeset/file-diff.ts`: `diffFor`, `rangeArgs`, `contextArgs`, `pairedRenameDiff`, `pairedRenameModeChange`, `bodyFromNoIndexDiff`, `reviewContentHash`, `oldRevision`, `newRevision`, `selectChangeRecord`.
  - `changeset/images.ts`, or keep it in `src/paths.ts` if it fits: `imageContentType`, `isImagePath`.
  - `changeset/files.ts`: the thin assembler `buildChangeFiles`, `buildChangeFilesForRange`, `listChangeRecords`, and `mapWithConcurrency`, which could move to a small `src/concurrency.ts` if another module wants it. Target: under about 300 lines.
  - **No file over about 500 lines.**
- [x] Imports:
  - Update all importers (`src/snapshot/*`, `src/changeset/*`, `src/server/routes/*`, tests) to import from the module that owns the function.
  - Don't leave `files.ts` re-exporting everything; a short transitional re-export is not wanted.
  - Keep `isBinaryContent` where it is unless moving it removes a cycle.
- [x] Dependency direction:
  - `parse.ts` is pure and depends only on `shared/`.
  - `objects.ts` and `file-diff.ts` depend on `src/git` and `parse.ts`.
  - `files.ts` depends on all of them, and nothing below `files.ts` imports it.
  - Add the rule "nothing in `src/changeset/` except the scope builders and the server routes imports `changeset/files`" to `test/layering.test.ts`, plus "`changeset/parse.ts` imports no IO module".
- [x] Tests:
  - Move or split the existing unit tests so they import from the new modules. Don't change their assertions.
  - Add direct unit tests for `parse.ts` where coverage only came through `buildChangeFiles` today.
- [x] Verification:
  - The API differential against main is byte-identical for every call in the scratchpad `urls25.txt` (the orchestrator runs it, so just say that you didn't change any output).
  - Plain `bun test` 3 times (no `--isolate`), typecheck and build.
