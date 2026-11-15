import { describe, expect, test } from "bun:test";
import {
  buildFolderTree,
  findFolderTreeFileRow,
  folderTreeAncestors,
  folderTreeFileKeys,
  folderTreeFolderKeys,
  visibleFolderTreeFileKeys,
  visibleFolderTreeRows,
  type FolderTreeEntry,
} from "../shared/folder-tree";

interface Payload {
  readonly id: string;
}

function entry(
  path: string,
  additions = 0,
  deletions = 0,
  reviewed = false,
): FolderTreeEntry<Payload> {
  return {
    path,
    payload: { id: path },
    additions,
    deletions,
    reviewed,
  };
}

describe("buildFolderTree", () => {
  test("sorts folders before files, case-insensitively", () => {
    const nodes = buildFolderTree([
      entry("zeta.ts"),
      entry("Alpha.ts"),
      entry("lib/x.ts"),
      entry("Docs/y.md"),
    ]);

    expect(nodes.map((node) => node.name)).toEqual([
      "Docs",
      "lib",
      "Alpha.ts",
      "zeta.ts",
    ]);
    expect(nodes.map((node) => node.kind)).toEqual([
      "folder",
      "folder",
      "file",
      "file",
    ]);
  });

  test("compacts single-child folder chains", () => {
    const nodes = buildFolderTree([
      entry("src/server/routes/a.ts", 3, 1, true),
    ]);

    expect(nodes).toHaveLength(1);
    const folder = nodes[0];
    expect(folder?.kind).toBe("folder");
    if (folder?.kind !== "folder") {
      throw new Error("expected a folder");
    }
    expect(folder.name).toBe("src/server/routes");
    expect(folder.path).toBe("src/server/routes");
    expect(folder.fileCount).toBe(1);
    expect(folder.additions).toBe(3);
    expect(folder.deletions).toBe(1);
    expect(folder.reviewedCount).toBe(1);
  });

  test("aggregates file counts, line totals and reviewed counts", () => {
    const nodes = buildFolderTree([
      entry("src/a.ts", 2, 1, true),
      entry("src/b.ts", 5, 0, false),
      entry("src/deep/c.ts", 1, 4, true),
      entry("lib/d.ts", 0, 2, false),
    ]);

    const src = nodes.find(
      (node) => node.kind === "folder" && node.path === "src",
    );
    if (src?.kind !== "folder") {
      throw new Error("expected src folder");
    }
    expect(src.fileCount).toBe(3);
    expect(src.additions).toBe(8);
    expect(src.deletions).toBe(5);
    expect(src.reviewedCount).toBe(2);

    const lib = nodes.find(
      (node) => node.kind === "folder" && node.path === "lib",
    );
    if (lib?.kind !== "folder") {
      throw new Error("expected lib folder");
    }
    expect(lib.fileCount).toBe(1);
    expect(lib.reviewedCount).toBe(0);
  });

  test("supports folder stubs whose children are not loaded", () => {
    const nodes = buildFolderTree<Payload>([
      entry("src/a.ts"),
      { kind: "folder", path: "lazy", childrenLoaded: false },
    ]);

    const lazy = nodes.find(
      (node) => node.kind === "folder" && node.path === "lazy",
    );
    if (lazy?.kind !== "folder") {
      throw new Error("expected lazy folder");
    }
    expect(lazy.childrenLoaded).toBe(false);
    expect(lazy.children).toEqual([]);
    expect(lazy.fileCount).toBe(0);
  });

  test("namespaces folder keys for per-commit trees", () => {
    const nodes = buildFolderTree([entry("src/a.ts")], {
      keyPrefix: "abc:",
    });
    const folder = nodes[0];
    expect(folder?.kind).toBe("folder");
    if (folder?.kind === "folder") {
      expect(folder.key).toBe("abc:src");
    }
  });
});

describe("folder tree rows", () => {
  const nodes = buildFolderTree([
    entry("src/a.ts"),
    entry("src/deep/b.ts"),
    entry("lib/c.ts"),
  ]);
  const folderKeys = folderTreeFolderKeys(nodes);

  test("flattens expanded folders into visible rows", () => {
    const rows = visibleFolderTreeRows(nodes, new Set(folderKeys));

    expect(
      rows.map((row) =>
        row.kind === "folder" ? `d${row.depth}:${row.node.name}` : `d${row.depth}:${row.node.name}`,
      ),
    ).toEqual([
      "d0:lib",
      "d1:c.ts",
      "d0:src",
      "d1:deep",
      "d2:b.ts",
      "d1:a.ts",
    ]);
    expect(visibleFolderTreeFileKeys(rows)).toEqual([
      "lib/c.ts",
      "src/deep/b.ts",
      "src/a.ts",
    ]);
  });

  test("hides children of collapsed folders", () => {
    const expanded = new Set(folderKeys);
    expanded.delete("src");
    const rows = visibleFolderTreeRows(nodes, expanded);

    expect(visibleFolderTreeFileKeys(rows)).toEqual(["lib/c.ts"]);
    expect(
      rows.some((row) => row.kind === "folder" && row.node.key === "src"),
    ).toBe(true);
  });

  test("finds a file row, its index and its ancestor folders", () => {
    const rows = visibleFolderTreeRows(nodes, new Set(folderKeys));
    const found = findFolderTreeFileRow(rows, "src/deep/b.ts");

    expect(found?.index).toBe(4);
    expect(found?.row.depth).toBe(2);
    expect(folderTreeAncestors(nodes, "src/deep/b.ts")).toEqual([
      "src",
      "src/deep",
    ]);
    expect(folderTreeAncestors(nodes, "missing.ts")).toEqual([]);
  });

  test("lists all file keys depth-first", () => {
    expect(folderTreeFileKeys(nodes)).toEqual([
      "lib/c.ts",
      "src/deep/b.ts",
      "src/a.ts",
    ]);
  });
});
