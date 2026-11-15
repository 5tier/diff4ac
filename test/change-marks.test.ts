import { describe, expect, test } from "bun:test";
import {
  beforeChangeMarks,
  changeMarks,
} from "../shared/diff/change-marks";
import type { Hunk, HunkLine, HunkLineType } from "../shared/types";

function line(
  type: HunkLineType,
  content: string,
  oldLine: number | null,
  newLine: number | null,
): HunkLine {
  return { type, content, oldLine, newLine };
}

function hunk(
  lines: readonly HunkLine[],
  oldStart = 1,
  newStart = 1,
): Hunk {
  return {
    header: `@@ -${oldStart} +${newStart} @@`,
    oldStart,
    oldLines: lines.filter((item) => item.type !== "add").length,
    newStart,
    newLines: lines.filter((item) => item.type !== "delete").length,
    lines,
  };
}

describe("change marks", () => {
  test("marks pure additions on new-side line numbers", () => {
    const hunks = [
      hunk([
        line("context", "a", 1, 1),
        line("add", "b", null, 2),
        line("add", "c", null, 3),
        line("context", "d", 2, 4),
      ]),
    ];

    expect(changeMarks(hunks)).toEqual({
      added: [{ start: 2, end: 3 }],
      modified: [],
      deletedAfter: [],
    });
    expect(beforeChangeMarks(hunks)).toEqual({
      removed: [],
      modified: [],
      addedAfter: [1],
    });
  });

  test("marks pure deletions after the previous new-side line", () => {
    const hunks = [
      hunk([
        line("context", "a", 1, 1),
        line("delete", "b", 2, null),
        line("delete", "c", 3, null),
        line("context", "d", 4, 2),
      ]),
    ];

    expect(changeMarks(hunks)).toEqual({
      added: [],
      modified: [],
      deletedAfter: [1],
    });
    expect(beforeChangeMarks(hunks)).toEqual({
      removed: [{ start: 2, end: 3 }],
      modified: [],
      addedAfter: [],
    });
  });

  test("marks a block with both sides as modified", () => {
    const hunks = [
      hunk([
        line("context", "a", 1, 1),
        line("delete", "b", 2, null),
        line("add", "B", null, 2),
        line("context", "c", 3, 3),
      ]),
    ];

    expect(changeMarks(hunks)).toEqual({
      added: [],
      modified: [{ start: 2, end: 2 }],
      deletedAfter: [],
    });
    expect(beforeChangeMarks(hunks)).toEqual({
      removed: [],
      modified: [{ start: 2, end: 2 }],
      addedAfter: [],
    });
  });

  test("keeps blocks separate and tracks hunk offsets", () => {
    const hunks = [
      hunk(
        [
          line("add", "top", null, 10),
          line("context", "a", 5, 11),
          line("delete", "old", 6, null),
          line("context", "b", 7, 12),
          line("delete", "gone", 8, null),
          line("add", "new", null, 13),
        ],
        5,
        10,
      ),
    ];

    expect(changeMarks(hunks)).toEqual({
      added: [{ start: 10, end: 10 }],
      modified: [{ start: 13, end: 13 }],
      deletedAfter: [11],
    });
    expect(beforeChangeMarks(hunks)).toEqual({
      removed: [{ start: 6, end: 6 }],
      modified: [{ start: 8, end: 8 }],
      addedAfter: [4],
    });
  });
});
