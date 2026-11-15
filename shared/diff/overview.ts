import type { Hunk } from "../types";
import { buildDiffRows, type DiffRow, type DiffViewMode } from "./rows";

export type OverviewMarkKind = "add" | "delete" | "mixed";

export interface OverviewFile {
  readonly key: string;
  readonly hunks: readonly Hunk[];
  readonly collapsed?: boolean;
  readonly binary?: boolean;
}

export interface OverviewMark {
  readonly fileKey: string;
  readonly startRow: number;
  readonly rowCount: number;
  readonly kind: OverviewMarkKind;
}

export interface OverviewBoundary {
  readonly fileKey: string;
  readonly row: number;
}

export interface ChangeOverview {
  readonly rowCount: number;
  readonly marks: readonly OverviewMark[];
  readonly boundaries: readonly OverviewBoundary[];
}

interface ChangeKinds {
  readonly add: boolean;
  readonly del: boolean;
}

function changeKinds(row: DiffRow): ChangeKinds | null {
  if (row.kind === "line") {
    if (row.type === "add") {
      return { add: true, del: false };
    }
    if (row.type === "delete") {
      return { add: false, del: true };
    }
    return null;
  }

  if (row.kind === "split") {
    let add = false;
    let del = false;
    for (const cell of [row.left, row.right]) {
      if (!cell) {
        continue;
      }
      if (cell.type === "add") {
        add = true;
      } else if (cell.type === "delete") {
        del = true;
      }
    }
    return add || del ? { add, del } : null;
  }

  return null;
}

function kindFor(add: boolean, del: boolean): OverviewMarkKind {
  if (add && del) {
    return "mixed";
  }
  return add ? "add" : "delete";
}

/**
 * One mark per contiguous block of changed rows, plus a tick at the first row
 * of every file that contributes rows. Positions are row indices in the same
 * model the diff panel renders, so they line up with `buildDiffRows` and
 * `ROW_HEIGHT` in both unified and side-by-side modes.
 */
export function buildChangeOverview(
  files: readonly OverviewFile[],
  mode: DiffViewMode,
): ChangeOverview {
  const marks: OverviewMark[] = [];
  const boundaries: OverviewBoundary[] = [];
  let rowCount = 0;

  for (const file of files) {
    const rows =
      file.binary || file.collapsed ? [] : buildDiffRows(file.hunks, mode);
    if (rows.length === 0) {
      continue;
    }

    const offset = rowCount;
    boundaries.push({ fileKey: file.key, row: offset });

    let blockStart = -1;
    let blockAdd = false;
    let blockDel = false;

    const flush = (end: number) => {
      if (blockStart < 0) {
        return;
      }
      marks.push({
        fileKey: file.key,
        startRow: offset + blockStart,
        rowCount: end - blockStart,
        kind: kindFor(blockAdd, blockDel),
      });
      blockStart = -1;
      blockAdd = false;
      blockDel = false;
    };

    rows.forEach((row, rowIndex) => {
      const kinds = changeKinds(row);
      if (!kinds) {
        flush(rowIndex);
        return;
      }
      if (blockStart < 0) {
        blockStart = rowIndex;
      }
      blockAdd = blockAdd || kinds.add;
      blockDel = blockDel || kinds.del;
    });
    flush(rows.length);

    rowCount += rows.length;
  }

  return { rowCount, marks, boundaries };
}
