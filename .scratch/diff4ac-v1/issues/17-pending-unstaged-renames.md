# 17: Pairing unstaged renames in Pending

**What to build:** When an Agent moves a file with plain `mv` and has not staged it, git reports a deleted file plus an untracked file, so Pending shows two unrelated entries and the whole file as new. diff4ac pairs them itself, without writing to the Repository (ADR 0002: no `git add -N`, no index changes), and shows a rename with only the real changes.

**Blocked by:** 05, 12

**Status:** ready-for-agent

- [ ] An unstaged deletion and an untracked file are paired as a rename when their content is identical (blob hash computed without writing objects) or similar enough (at least 50% similar, git's default)
- [ ] Each deleted and each untracked file is used in at most one pair; ties go to the most similar candidate, then path order
- [ ] A paired rename shows `old → new` with only the content changes (the old side is the deleted file's index content)
- [ ] Pairing is bounded so large Pending sets stay fast (for example, skip similarity for files over 1 MB or when candidates exceed a sensible limit)
- [ ] Review Marks, Filters, image previews and binary handling still work on paired renames
- [ ] Any temporary files live outside the Repository and are cleaned up; the Repository and its index are untouched
- [ ] Fixture tests cover exact move, move-plus-edit, a non-match (stays delete + untracked), and that `git status` output is unchanged afterwards
