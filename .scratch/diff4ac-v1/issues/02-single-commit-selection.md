# 02: Single-commit Selection

**What to build:** The Reviewer sees a Commits panel listing the Repository's history (message, author, relative date, short hash). Choosing a commit makes it the Selection and shows its Change Set (its diff against its parent) in the file list and Diff.

**Blocked by:** 01

**Status:** done

- [x] Commits panel lists commits on the current branch, newest first, with message, author, relative date and short hash
- [x] Selecting a commit changes the Selection; the file list and Diff show that commit's Change Set
- [x] A root commit (with no parent) displays correctly
- [x] The status bar states the current Selection
- [x] Fixture tests cover the commit list and a single-commit Change Set, including the root commit
