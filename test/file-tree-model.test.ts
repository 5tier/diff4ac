import { describe, expect, test } from "bun:test";
import type { ChangeFile, CommitChangeGroup, CommitSummary } from "../shared/types";
import {
  buildFileTreeModel,
  cursorForView,
  expandKeysForFile,
  fileKeyAtCursor,
  visibleFileRowIndexRevealed,
} from "../web/state/file-tree";

function file(path: string, additions = 1, reviewed = false): ChangeFile {
  return {
    path,
    status: "modified",
    additions,
    deletions: 1,
    binary: false,
    diff: "",
    hunks: [],
    contentHash: `hash-${path}`,
    oldRev: "old",
    newRev: "new",
    reviewed,
  };
}

function commit(hash: string, message = hash): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message,
    author: { name: "Ada", email: "ada@example.com" },
    committedAt: "2026-06-01T12:00:00Z",
    relativeDate: "now",
    firstParent: null,
    agent: null,
  };
}

describe("file tree model", () => {
  test("maps the flat file order to visible tree rows", () => {
    const files = [file("src/b.ts"), file("src/a.ts"), file("README.md")];
    const model = buildFileTreeModel(files, [], false, []);
    const keys = model.rows.map((row) =>
      row.kind === "file" ? row.node.key : row.node.key,
    );

    expect(model.flatFileKeys).toEqual([
      "src/b.ts",
      "src/a.ts",
      "README.md",
    ]);
    expect(keys).toEqual(["src", "src/a.ts", "src/b.ts", "README.md"]);
    expect(model.visibleFileKeys).toEqual([
      "src/a.ts",
      "src/b.ts",
      "README.md",
    ]);
  });

  test("keeps the selected file visible when switching views", () => {
    const files = [file("src/deep/a.ts"), file("src/deep/b.ts")];
    const model = buildFileTreeModel(files, [], false, []);

    const listKey = fileKeyAtCursor(model, "list", 1, "src/deep/b.ts");
    expect(listKey).toBe("src/deep/b.ts");
    expect(cursorForView(model, "list", listKey)).toBe(1);

    const treeIndex = cursorForView(model, "tree", listKey);
    expect(treeIndex).toBe(2);
    const treeKey = fileKeyAtCursor(model, "tree", treeIndex, "src/deep/b.ts");
    expect(treeKey).toBe("src/deep/b.ts");
  });

  test("reveals a file inside a collapsed folder", () => {
    const files = [file("src/deep/a.ts")];
    const model = buildFileTreeModel(files, [], false, ["src/deep"]);
    expect(model.rows.some((row) => row.kind === "file")).toBe(false);

    expect(expandKeysForFile(model, "src/deep/a.ts")).toEqual(["src/deep"]);
    expect(visibleFileRowIndexRevealed(model, "src/deep/a.ts")).toBe(1);
  });

  test("builds one tree section per commit in Commit Stack", () => {
    const first = commit("aaaa");
    const second = commit("bbbb");
    const a = file("src/a.ts");
    const groups: CommitChangeGroup[] = [
      {
        commit: second,
        files: [a],
        totals: { files: 1, additions: 1, deletions: 1 },
      },
      {
        commit: first,
        files: [a],
        totals: { files: 1, additions: 1, deletions: 1 },
      },
    ];
    const model = buildFileTreeModel([a, a], groups, true, []);

    expect(model.sections.map((section) => section.key)).toEqual([
      "bbbb",
      "aaaa",
    ]);
    expect(model.flatFileKeys).toEqual(["bbbb:src/a.ts", "aaaa:src/a.ts"]);
    expect(model.visibleFileKeys).toEqual([
      "bbbb:src/a.ts",
      "aaaa:src/a.ts",
    ]);
  });
});
