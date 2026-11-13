# 14: Review Marks

**What to build:** The Reviewer presses `m` on a file to mark it reviewed. Marks are shown in the file tree and counted ("3/11 reviewed"), and they persist across sessions under `~/.diff4ac/`, never inside the Repository. A mark is tied to the file's specific new content, so it lapses automatically when an Agent changes that file again.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `m` toggles a Review Mark on the selected file; marked files are visibly distinct in the file tree
- [ ] The status bar shows reviewed/total for the current Change Set
- [ ] Marks persist under `~/.diff4ac/`, keyed by Repository identity, path and new-content hash, and nothing is written to the Repository
- [ ] A mark no longer applies once the file's new content differs
- [ ] Deleted files can be marked (keyed on the deletion)
- [ ] Fixture tests: mark a file, change its content, and assert the mark lapses; an unchanged file stays marked across sessions
