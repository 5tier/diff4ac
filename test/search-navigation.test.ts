import { describe, expect, test } from "bun:test";
import type { Hunk, HunkLine } from "../shared/types";
import { buildDiffRows } from "../shared/diff/rows";
import {
  findSearchMatches,
  groupMatchesByRow,
  stepMatchIndex,
  type SearchFile,
} from "../shared/diff/search";
import {
  buildHunkAnchors,
  hunkAtRow,
  nextFileTarget,
  nextHunkTarget,
} from "../shared/diff/navigation";
import {
  fileKeyAtOffset,
  offsetForRow,
  rowAtOffset,
  type LayoutFile,
  type PaneLayout,
} from "../shared/diff/layout";

function line(
  type: HunkLine["type"],
  content: string,
  oldLine: number | null,
  newLine: number | null,
): HunkLine {
  return { type, content, oldLine, newLine };
}

function hunk(index: number, lines: readonly HunkLine[]): Hunk {
  return {
    header: `@@ -${index + 1},${lines.length} +${index + 1},${lines.length} @@`,
    oldStart: index + 1,
    oldLines: lines.length,
    newStart: index + 1,
    newLines: lines.length,
    lines,
  };
}

function file(
  key: string,
  hunks: readonly Hunk[],
  extra: Partial<SearchFile> = {},
): SearchFile {
  return { key, path: key, hunks, ...extra };
}

const firstHunk = hunk(0, [
  line("context", "alpha needle one", 1, 1),
  line("add", "needle two", null, 2),
  line("delete", "other", 2, null),
  line("context", "same", 3, 3),
]);

const secondHunk = hunk(4, [
  line("context", "later context", 5, 5),
  line("add", "needle three", null, 6),
]);

describe("search", () => {
  test("finds case-insensitive matches across files in the Change Set", () => {
    const files = [
      file("src/a.ts", [firstHunk]),
      file("src/b.ts", [secondHunk]),
    ];

    const matches = findSearchMatches(files, "NEEDLE", "unified");

    expect(
      matches.map((match) => [match.fileKey, match.row, match.cell]),
    ).toEqual([
      ["src/a.ts", 1, "line"],
      ["src/a.ts", 2, "line"],
      ["src/b.ts", 2, "line"],
    ]);
  });

  test("counts a shared side-by-side context row once but highlights both cells", () => {
    const files = [file("src/a.ts", [firstHunk])];

    const matches = findSearchMatches(files, "needle", "side-by-side");
    expect(matches).toHaveLength(2);
    expect(matches[0]?.cell).toBe("both");

    const byRow = groupMatchesByRow(matches);
    const contextRow = byRow.get(matches[0]?.row ?? -1);
    expect(contextRow?.left).toHaveLength(1);
    expect(contextRow?.right).toHaveLength(1);
  });

  test("skips binary and collapsed files that have no loaded hunks", () => {
    const files = [
      file("src/a.ts", [firstHunk]),
      file("image.png", [], { collapsed: true }),
    ];

    const matches = findSearchMatches(files, "needle", "unified");
    expect(matches.every((match) => match.fileKey === "src/a.ts")).toBe(true);
  });

  test("steps through matches and wraps in both directions", () => {
    expect(stepMatchIndex(3, -1, 1)).toBe(0);
    expect(stepMatchIndex(3, -1, -1)).toBe(2);
    expect(stepMatchIndex(3, 2, 1)).toBe(0);
    expect(stepMatchIndex(3, 0, -1)).toBe(2);
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
  });
});

describe("diff navigation", () => {
  const files = [
    file("src/a.ts", [firstHunk, secondHunk]),
    file("logo.bin", []),
    file("src/c.ts", [
      hunk(0, [line("context", "third file", 1, 1)]),
    ]),
  ];

  test("anchors every hunk with its row in the built diff", () => {
    const anchors = buildHunkAnchors(files, "unified");
    expect(anchors.map((anchor) => [anchor.fileKey, anchor.hunkIndex])).toEqual(
      [
        ["src/a.ts", 0],
        ["src/a.ts", 1],
        ["src/c.ts", 0],
      ],
    );

    const rows = buildDiffRows(files[0]?.hunks ?? [], "unified");
    expect(rows[anchors[1]?.row ?? -1]?.kind).toBe("hunk");
  });

  test("jumps to the next and previous hunk across file boundaries", () => {
    expect(
      nextHunkTarget(
        files,
        "unified",
        { fileKey: "src/a.ts", hunkIndex: 0 },
        1,
      ),
    ).toMatchObject({ fileKey: "src/a.ts", hunkIndex: 1 });
    expect(
      nextHunkTarget(
        files,
        "unified",
        { fileKey: "src/a.ts", hunkIndex: 1 },
        1,
      ),
    ).toMatchObject({ fileKey: "src/c.ts", hunkIndex: 0 });
    expect(
      nextHunkTarget(
        files,
        "unified",
        { fileKey: "src/c.ts", hunkIndex: 0 },
        -1,
      ),
    ).toMatchObject({ fileKey: "src/a.ts", hunkIndex: 1 });
    expect(
      nextHunkTarget(
        files,
        "unified",
        { fileKey: "src/c.ts", hunkIndex: 0 },
        1,
      ),
    ).toBeNull();
  });

  test("starts with the first or last hunk when there is no current location", () => {
    expect(nextHunkTarget(files, "unified", null, 1)).toMatchObject({
      fileKey: "src/a.ts",
      hunkIndex: 0,
    });
    expect(nextHunkTarget(files, "unified", null, -1)).toMatchObject({
      fileKey: "src/c.ts",
      hunkIndex: 0,
    });
  });

  test("crosses files that have no hunks", () => {
    expect(
      nextHunkTarget(
        files,
        "unified",
        { fileKey: "logo.bin", hunkIndex: -1 },
        1,
      ),
    ).toMatchObject({ fileKey: "src/c.ts", hunkIndex: 0 });
    expect(
      nextHunkTarget(
        files,
        "unified",
        { fileKey: "logo.bin", hunkIndex: -1 },
        -1,
      ),
    ).toMatchObject({ fileKey: "src/a.ts", hunkIndex: 1 });
  });

  test("jumps between files including files without hunks", () => {
    expect(nextFileTarget(files, "src/a.ts", 1)).toMatchObject({
      fileKey: "logo.bin",
      fileIndex: 1,
      row: 0,
    });
    expect(nextFileTarget(files, "logo.bin", 1)).toMatchObject({
      fileKey: "src/c.ts",
      fileIndex: 2,
    });
    expect(nextFileTarget(files, "src/c.ts", 1)).toBeNull();
    expect(nextFileTarget(files, null, -1)).toMatchObject({
      fileKey: "src/c.ts",
    });
  });

  test("resolves the current hunk from a row inside a file", () => {
    const anchors = buildHunkAnchors(files, "unified");
    const second = anchors[1];
    expect(
      hunkAtRow(
        files,
        "unified",
        "src/a.ts",
        (second?.row ?? 0) + 1,
      ),
    ).toEqual({ fileKey: "src/a.ts", hunkIndex: 1 });
    expect(hunkAtRow(files, "unified", "logo.bin", 0)).toBeNull();
  });

  test("anchors each block of changes inside one whole-file hunk", () => {
    const whole = [
      file("src/whole.ts", [
        hunk(0, [
          line("context", "one", 1, 1),
          line("add", "two", null, 2),
          line("context", "three", 2, 3),
          line("context", "four", 3, 4),
          line("delete", "five", 4, null),
          line("add", "five!", null, 5),
          line("context", "six", 5, 6),
          line("add", "seven", null, 7),
        ]),
      ]),
    ];
    for (const mode of ["unified", "side-by-side"] as const) {
      const anchors = buildHunkAnchors(whole, mode);
      expect(anchors).toHaveLength(3);
      const rows = buildDiffRows(whole[0]?.hunks ?? [], mode);
      expect(rows[anchors[0]?.row ?? -1]?.kind).toBe("hunk");
      expect(nextHunkTarget(whole, mode, anchors[0] ?? null, 1)).toMatchObject({
        hunkIndex: 1,
      });
    }
  });
});

function layoutFile(
  fileKey: string,
  top: number,
  rowsTop: number | null,
  rowCount: number,
  bottom: number,
  rowStart = 0,
): LayoutFile {
  return { fileKey, top, rowsTop, rowHeight: 20, rowCount, bottom, rowStart };
}

function layout(files: readonly LayoutFile[]): PaneLayout {
  return {
    scrollHeight: 1000,
    clientHeight: 200,
    stickyHeight: 34,
    blocks: [],
    files: new Map(files.map((entry) => [entry.fileKey, entry])),
    fileOrder: files.map((entry) => entry.fileKey),
  };
}

const pane = layout([
  layoutFile("src/a.ts", 0, 34, 5, 500, 0),
  layoutFile("src/b.ts", 500, 534, 3, 900, 5),
  layoutFile("empty.ts", 900, null, 0, 1000, 8),
]);

describe("pane layout", () => {
  test("maps an offset to the current file", () => {
    expect(fileKeyAtOffset(pane, 0)).toBe("src/a.ts");
    expect(fileKeyAtOffset(pane, 33)).toBe("src/a.ts");
    expect(fileKeyAtOffset(pane, 34)).toBe("src/a.ts");
    expect(fileKeyAtOffset(pane, 499)).toBe("src/a.ts");
    expect(fileKeyAtOffset(pane, 500)).toBe("src/b.ts");
    expect(fileKeyAtOffset(pane, 950)).toBe("empty.ts");
  });

  test("maps an offset to a row and back", () => {
    const first = pane.files.get("src/a.ts");
    if (!first) {
      throw new Error("missing first file");
    }
    expect(rowAtOffset(first, 34)).toBe(0);
    expect(rowAtOffset(first, 53)).toBe(0);
    expect(rowAtOffset(first, 54)).toBe(1);
    expect(rowAtOffset(first, -10)).toBe(0);
    expect(rowAtOffset(first, 500)).toBe(4);

    expect(offsetForRow(first, 0)).toBe(34);
    expect(offsetForRow(first, 2)).toBe(74);
    expect(offsetForRow(first, 99)).toBe(114);
  });

  test("falls back to the file heading for files without rows", () => {
    const empty = pane.files.get("empty.ts");
    if (!empty) {
      throw new Error("missing empty file");
    }
    expect(rowAtOffset(empty, 950)).toBe(0);
    expect(offsetForRow(empty, 0)).toBe(900);
    expect(offsetForRow(empty, 3)).toBe(900);
  });

  test("uses the sticky heading height for jump offsets", () => {
    const first = pane.files.get("src/a.ts");
    if (!first) {
      throw new Error("missing first file");
    }
    const target = offsetForRow(first, 2) - pane.stickyHeight;
    expect(target).toBe(40);
  });
});
