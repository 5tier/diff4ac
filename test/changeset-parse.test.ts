import { describe, expect, test } from "bun:test";
import {
  countDiffLines,
  looksBinary,
  parseHunks,
  parseNameStatus,
  parseNumstat,
  statusFromCode,
} from "../src/changeset/parse";

describe("changeset parse", () => {
  test("maps name-status codes to FileStatus", () => {
    expect(statusFromCode("A")).toBe("added");
    expect(statusFromCode("D")).toBe("deleted");
    expect(statusFromCode("R100")).toBe("renamed");
    expect(statusFromCode("C75")).toBe("copied");
    expect(statusFromCode("T")).toBe("typechanged");
    expect(statusFromCode("U")).toBe("unmerged");
    expect(statusFromCode("M")).toBe("modified");
    expect(statusFromCode("X")).toBe("modified");
  });

  test("parses null-separated name-status output", () => {
    expect(
      parseNameStatus("M\0src/a.ts\0A\0new.ts\0D\0gone.ts\0"),
    ).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "new.ts", status: "added" },
      { path: "gone.ts", status: "deleted" },
    ]);
  });

  test("parses renames and copies with both paths", () => {
    expect(
      parseNameStatus("R100\0old.ts\0new.ts\0C75\0src.ts\0copy.ts\0"),
    ).toEqual([
      { path: "new.ts", oldPath: "old.ts", status: "renamed" },
      { path: "copy.ts", oldPath: "src.ts", status: "copied" },
    ]);
  });

  test("parses null-separated numstat output", () => {
    const records = parseNumstat("3\t4\tsrc/a.ts\0-\t-\timg.png\0");
    expect(records.get("src/a.ts")).toEqual({
      additions: 3,
      deletions: 4,
      binary: false,
    });
    expect(records.get("img.png")).toEqual({
      additions: 0,
      deletions: 0,
      binary: true,
    });
  });

  test("parses rename numstat whose path field is empty", () => {
    const records = parseNumstat("1\t2\t\0old.ts\0new.ts\0");
    expect(records.get("new.ts")).toEqual({
      additions: 1,
      deletions: 2,
      binary: false,
    });
    expect(records.has("old.ts")).toBe(false);
  });

  test("parses hunks with context, add and delete lines", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    expect(parseHunks(diff)).toEqual([
      {
        header: "@@ -1,2 +1,2 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { type: "context", content: "keep", oldLine: 1, newLine: 1 },
          { type: "delete", content: "old", oldLine: 2, newLine: null },
          { type: "add", content: "new", oldLine: null, newLine: 2 },
        ],
      },
    ]);
  });

  test("defaults omitted hunk counts to one line", () => {
    const [hunk] = parseHunks("@@ -5 +7 @@\n+x\n");
    expect(hunk).toMatchObject({
      oldStart: 5,
      oldLines: 1,
      newStart: 7,
      newLines: 1,
    });
  });

  test("detects binary diffs from their header", () => {
    expect(looksBinary("Binary files a/x.png and b/x.png differ\n")).toBe(true);
    expect(looksBinary("GIT binary patch\nliteral 3\n")).toBe(true);
    expect(looksBinary("diff --git a/a b/a\n@@ -1 +1 @@\n")).toBe(false);
  });

  test("counts additions and deletions inside hunks only", () => {
    const diff = [
      "diff --git a/a b/a",
      "+++ b/a",
      "@@ -1,1 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "+more",
      "",
    ].join("\n");
    expect(countDiffLines(diff)).toEqual({ additions: 2, deletions: 1 });
    expect(countDiffLines("diff --git a/a b/a\n+++ b/a\n")).toEqual({
      additions: 0,
      deletions: 0,
    });
  });
});
