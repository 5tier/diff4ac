import { buildDiffRows, type DiffRow, type DiffViewMode } from "./rows";
import type { SearchFile } from "./search";

export interface HunkLocation {
  readonly fileKey: string;
  readonly hunkIndex: number;
}

export interface HunkTarget extends HunkLocation {
  readonly fileIndex: number;
  readonly row: number;
}

export interface FileTarget {
  readonly fileKey: string;
  readonly fileIndex: number;
  readonly hunkIndex: number;
  readonly row: number;
}

function isChangeRow(row: DiffRow): boolean {
  if (row.kind === "line") {
    return row.type !== "context";
  }
  if (row.kind === "split") {
    return (
      (row.left !== null && row.left.type !== "context") ||
      (row.right !== null && row.right.type !== "context")
    );
  }
  return false;
}

/**
 * One anchor per hunk header plus one for each further block of changed
 * lines inside a hunk, so `]`/`[` still step through changes when a file is
 * shown whole (a single git hunk).
 */
export function buildHunkAnchors(
  files: readonly SearchFile[],
  mode: DiffViewMode,
): HunkTarget[] {
  const anchors: HunkTarget[] = [];

  files.forEach((file, fileIndex) => {
    const rows = buildDiffRows(file.hunks, mode);
    let hunkIndex = 0;
    let firstBlockInHunk = true;
    let inChange = false;
    const push = (row: number) => {
      anchors.push({ fileKey: file.key, fileIndex, hunkIndex, row });
      hunkIndex++;
    };
    rows.forEach((row, rowIndex) => {
      if (row.kind === "hunk") {
        push(rowIndex);
        firstBlockInHunk = true;
        inChange = false;
        return;
      }
      const changed = isChangeRow(row);
      if (changed && !inChange) {
        if (!firstBlockInHunk) {
          push(rowIndex);
        }
        firstBlockInHunk = false;
      }
      inChange = changed;
    });
  });

  return anchors;
}

export function hunkAtRow(
  files: readonly SearchFile[],
  mode: DiffViewMode,
  fileKey: string,
  row: number,
): HunkLocation | null {
  const anchors = buildHunkAnchors(files, mode).filter(
    (anchor) => anchor.fileKey === fileKey,
  );
  if (anchors.length === 0) {
    return null;
  }

  let current = anchors[0] as HunkTarget;
  for (const anchor of anchors) {
    if (anchor.row <= row) {
      current = anchor;
    } else {
      break;
    }
  }

  return { fileKey: current.fileKey, hunkIndex: current.hunkIndex };
}

export function nextHunkTarget(
  files: readonly SearchFile[],
  mode: DiffViewMode,
  current: HunkLocation | null,
  direction: 1 | -1,
): HunkTarget | null {
  const anchors = buildHunkAnchors(files, mode);
  if (anchors.length === 0) {
    return null;
  }

  if (!current) {
    return direction === 1
      ? (anchors[0] as HunkTarget)
      : (anchors[anchors.length - 1] as HunkTarget);
  }

  const exact = anchors.findIndex(
    (anchor) =>
      anchor.fileKey === current.fileKey &&
      anchor.hunkIndex === current.hunkIndex,
  );
  if (exact >= 0) {
    return anchors[exact + direction] ?? null;
  }

  const currentFileIndex = files.findIndex(
    (file) => file.key === current.fileKey,
  );
  if (currentFileIndex < 0) {
    return direction === 1
      ? (anchors[0] as HunkTarget)
      : (anchors[anchors.length - 1] as HunkTarget);
  }

  if (direction === 1) {
    return (
      anchors.find(
        (anchor) =>
          anchor.fileIndex > currentFileIndex ||
          (anchor.fileIndex === currentFileIndex &&
            anchor.hunkIndex >= current.hunkIndex),
      ) ?? null
    );
  }

  return (
    [...anchors]
      .reverse()
      .find(
        (anchor) =>
          anchor.fileIndex < currentFileIndex ||
          (anchor.fileIndex === currentFileIndex &&
            anchor.hunkIndex <= current.hunkIndex),
      ) ?? null
  );
}

export function nextFileTarget(
  files: readonly SearchFile[],
  currentFileKey: string | null,
  direction: 1 | -1,
): FileTarget | null {
  if (files.length === 0) {
    return null;
  }

  let index: number;
  if (!currentFileKey) {
    index = direction === 1 ? 0 : files.length - 1;
  } else {
    const current = files.findIndex((file) => file.key === currentFileKey);
    if (current < 0) {
      index = direction === 1 ? 0 : files.length - 1;
    } else {
      index = current + direction;
      if (index < 0 || index >= files.length) {
        return null;
      }
    }
  }

  const file = files[index];
  if (!file) {
    return null;
  }

  return { fileKey: file.key, fileIndex: index, hunkIndex: 0, row: 0 };
}
