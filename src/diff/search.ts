import type { Hunk } from "../types";
import {
  buildDiffRows,
  type DiffRow,
  type DiffViewMode,
  type LineRow,
  type SplitRow,
} from "./rows";

export interface SearchFile {
  readonly key: string;
  readonly path: string;
  readonly hunks: readonly Hunk[];
  readonly collapsed?: boolean;
}

export type SearchCell = "line" | "left" | "right" | "both";

export interface SearchMatch {
  readonly fileKey: string;
  readonly path: string;
  readonly row: number;
  readonly cell: SearchCell;
  readonly start: number;
  readonly end: number;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMatches(text: string, query: string): TextRange[] {
  if (query === "") {
    return [];
  }

  const pattern = new RegExp(escapeRegExp(query), "gi");
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

function matchesForRow(
  file: SearchFile,
  rowIndex: number,
  row: DiffRow,
  query: string,
): SearchMatch[] {
  const matches: SearchMatch[] = [];

  const add = (cell: SearchCell, text: string) => {
    for (const range of textMatches(text, query)) {
      matches.push({
        fileKey: file.key,
        path: file.path,
        row: rowIndex,
        cell,
        start: range.start,
        end: range.end,
      });
    }
  };

  if (row.kind === "line") {
    add("line", (row as LineRow).content);
    return matches;
  }

  if (row.kind === "split") {
    const split = row as SplitRow;
    if (
      split.left &&
      split.right &&
      split.left.content === split.right.content
    ) {
      add("both", split.left.content);
      return matches;
    }

    if (split.left) {
      add("left", split.left.content);
    }
    if (split.right) {
      add("right", split.right.content);
    }
  }

  return matches;
}

export function findSearchMatches(
  files: readonly SearchFile[],
  query: string,
  mode: DiffViewMode,
): SearchMatch[] {
  if (query === "") {
    return [];
  }

  const matches: SearchMatch[] = [];
  for (const file of files) {
    const rows = buildDiffRows(file.hunks, mode);
    rows.forEach((row, rowIndex) => {
      matches.push(...matchesForRow(file, rowIndex, row, query));
    });
  }
  return matches;
}

export function stepMatchIndex(
  count: number,
  current: number,
  direction: 1 | -1,
): number {
  if (count <= 0) {
    return -1;
  }
  const start = current >= 0 && current < count ? current : direction === 1 ? -1 : 0;
  return (start + direction + count) % count;
}

export interface RowSearchMatches {
  readonly line: readonly SearchMatch[];
  readonly left: readonly SearchMatch[];
  readonly right: readonly SearchMatch[];
}

export function groupMatchesByRow(
  matches: readonly SearchMatch[],
): Map<number, RowSearchMatches> {
  const byRow = new Map<
    number,
    { line: SearchMatch[]; left: SearchMatch[]; right: SearchMatch[] }
  >();

  for (const match of matches) {
    let entry = byRow.get(match.row);
    if (!entry) {
      entry = { line: [], left: [], right: [] };
      byRow.set(match.row, entry);
    }

    if (match.cell === "line") {
      entry.line.push(match);
    } else if (match.cell === "left") {
      entry.left.push(match);
    } else if (match.cell === "right") {
      entry.right.push(match);
    } else {
      entry.left.push(match);
      entry.right.push(match);
    }
  }

  return byRow;
}
