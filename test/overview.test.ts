import { describe, expect, test } from "bun:test";
import type { Hunk, HunkLine } from "../src/types";
import { buildDiffRows } from "../src/diff/rows";
import {
  buildChangeOverview,
  type OverviewFile,
} from "../src/diff/overview";

function line(
  type: HunkLine["type"],
  content: string,
  oldLine: number | null,
  newLine: number | null,
): HunkLine {
  return { type, content, oldLine, newLine };
}

function hunk(lines: readonly HunkLine[]): Hunk {
  return {
    header: `@@ -1,${lines.length} +1,${lines.length} @@`,
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    lines,
  };
}

function file(
  key: string,
  hunks: readonly Hunk[],
  extra: Partial<OverviewFile> = {},
): OverviewFile {
  return { key, hunks, ...extra };
}

const firstHunk = hunk([
  line("context", "one", 1, 1),
  line("add", "two", null, 2),
  line("add", "three", null, 3),
  line("context", "four", 2, 4),
  line("delete", "five", 3, null),
  line("add", "five!", null, 5),
  line("context", "six", 4, 6),
]);

const secondHunk = hunk([
  line("context", "ten", 1, 1),
  line("delete", "eleven", 2, null),
  line("context", "twelve", 3, 3),
]);

describe("change overview", () => {
  test("marks contiguous changed rows in unified mode", () => {
    const overview = buildChangeOverview(
      [file("src/a.ts", [firstHunk]), file("src/b.ts", [secondHunk])],
      "unified",
    );

    expect(overview.rowCount).toBe(
      buildDiffRows([firstHunk], "unified").length +
        buildDiffRows([secondHunk], "unified").length,
    );
    expect(overview.boundaries).toEqual([
      { fileKey: "src/a.ts", row: 0 },
      { fileKey: "src/b.ts", row: 8 },
    ]);
    expect(overview.marks).toEqual([
      {
        fileKey: "src/a.ts",
        startRow: 2,
        rowCount: 2,
        kind: "add",
      },
      {
        fileKey: "src/a.ts",
        startRow: 5,
        rowCount: 2,
        kind: "mixed",
      },
      {
        fileKey: "src/b.ts",
        startRow: 10,
        rowCount: 1,
        kind: "delete",
      },
    ]);
  });

  test("pairs adds and deletes per split row in side-by-side mode", () => {
    const overview = buildChangeOverview(
      [file("src/a.ts", [firstHunk]), file("src/b.ts", [secondHunk])],
      "side-by-side",
    );

    expect(overview.boundaries).toEqual([
      { fileKey: "src/a.ts", row: 0 },
      { fileKey: "src/b.ts", row: 7 },
    ]);
    expect(overview.marks).toEqual([
      {
        fileKey: "src/a.ts",
        startRow: 2,
        rowCount: 2,
        kind: "add",
      },
      {
        fileKey: "src/a.ts",
        startRow: 5,
        rowCount: 1,
        kind: "mixed",
      },
      {
        fileKey: "src/b.ts",
        startRow: 9,
        rowCount: 1,
        kind: "delete",
      },
    ]);
  });

  test("separates blocks split by unchanged context", () => {
    const overview = buildChangeOverview(
      [
        file("src/a.ts", [
          hunk([
            line("add", "one", null, 1),
            line("context", "two", 1, 2),
            line("delete", "three", 2, null),
            line("add", "four", null, 3),
          ]),
        ]),
      ],
      "unified",
    );

    expect(overview.marks.map((mark) => [mark.startRow, mark.kind])).toEqual([
      [1, "add"],
      [3, "mixed"],
    ]);
  });

  test("skips collapsed and binary files without emitting marks or boundaries", () => {
    const overview = buildChangeOverview(
      [
        file("src/a.ts", [firstHunk]),
        file("src/collapsed.ts", [secondHunk], { collapsed: true }),
        file("assets/logo.png", [secondHunk], { binary: true }),
      ],
      "unified",
    );

    expect(overview.rowCount).toBe(buildDiffRows([firstHunk], "unified").length);
    expect(overview.marks.every((mark) => mark.fileKey === "src/a.ts")).toBe(
      true,
    );
    expect(overview.boundaries.map((boundary) => boundary.fileKey)).toEqual([
      "src/a.ts",
    ]);
  });

  test("returns an empty overview when nothing renders rows", () => {
    expect(
      buildChangeOverview(
        [file("src/empty.ts", []), file("src/a.ts", [firstHunk], { collapsed: true })],
        "unified",
      ),
    ).toEqual({ rowCount: 0, marks: [], boundaries: [] });
  });
});
