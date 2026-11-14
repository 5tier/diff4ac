# 12: Renames, binary files, image previews, large diffs

**What to build:** Awkward files are handled sensibly. Renames show old path → new path with only the real changes. Binary files show "binary changed" with old and new sizes. Changed images show a before/after preview. File diffs over about 1,500 changed lines are collapsed and loaded on demand.

**Blocked by:** 02

**Status:** done

- [x] Renames are detected and shown as old → new, with only the content changes
- [x] Binary files show "binary changed" with old and new sizes, and no garbage text
- [x] Image files (png, jpg, gif, webp, svg) show before and after previews, served by the API
- [x] File diffs over about 1,500 changed lines are collapsed, with a key to load and expand them
- [x] Fixture tests cover a rename with edits, a binary change, an image change and an oversized diff
