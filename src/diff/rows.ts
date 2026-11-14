import type { Hunk, HunkLine, HunkLineType } from "../types";
import { changeBlocks, wordDiffsForHunk } from "./pairing";
import type { WordDiff, WordRange } from "./word-diff";

export interface TokenSpan {
  readonly content: string;
  readonly style?: Readonly<Record<string, string>>;
}

export interface HunkHighlight {
  readonly old: readonly (readonly TokenSpan[] | null)[];
  readonly new: readonly (readonly TokenSpan[] | null)[];
}

export type DiffViewMode = "unified" | "side-by-side";

export interface HunkRow {
  readonly kind: "hunk";
  readonly key: string;
  readonly header: string;
}

export interface LineRow {
  readonly kind: "line";
  readonly key: string;
  readonly type: HunkLineType;
  readonly content: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly tokens: readonly TokenSpan[] | null;
  readonly word: readonly WordRange[] | null;
}

export interface SplitCell {
  readonly type: HunkLineType;
  readonly content: string;
  readonly lineNumber: number | null;
  readonly tokens: readonly TokenSpan[] | null;
  readonly word: readonly WordRange[] | null;
}

export interface SplitRow {
  readonly kind: "split";
  readonly key: string;
  readonly left: SplitCell | null;
  readonly right: SplitCell | null;
}

export type DiffRow = HunkRow | LineRow | SplitRow;

function hunkRow(hunk: Hunk, hunkIndex: number): HunkRow {
  return {
    kind: "hunk",
    key: `h${hunkIndex}`,
    header: hunk.header,
  };
}

function wordFor(
  diffs: Map<number, WordDiff>,
  lineIndex: number,
  line: HunkLine,
): readonly WordRange[] | null {
  const diff = diffs.get(lineIndex);
  if (!diff) {
    return null;
  }

  const ranges = line.type === "delete" ? diff.removed : diff.added;
  return ranges.length > 0 ? ranges : null;
}

function buildUnifiedRows(
  hunks: readonly Hunk[],
  highlights: readonly HunkHighlight[] | null,
): DiffRow[] {
  const rows: DiffRow[] = [];

  hunks.forEach((hunk, hunkIndex) => {
    rows.push(hunkRow(hunk, hunkIndex));
    const diffs = wordDiffsForHunk(hunk);
    const highlight = highlights?.[hunkIndex] ?? null;
    let oldIndex = 0;
    let newIndex = 0;

    hunk.lines.forEach((line, lineIndex) => {
      let tokens: readonly TokenSpan[] | null = null;

      if (line.type === "add") {
        tokens = highlight?.new[newIndex] ?? null;
        newIndex++;
      } else if (line.type === "delete") {
        tokens = highlight?.old[oldIndex] ?? null;
        oldIndex++;
      } else {
        tokens = highlight?.new[newIndex] ?? highlight?.old[oldIndex] ?? null;
        oldIndex++;
        newIndex++;
      }

      rows.push({
        kind: "line",
        key: `h${hunkIndex}l${lineIndex}`,
        type: line.type,
        content: line.content,
        oldLine: line.oldLine,
        newLine: line.newLine,
        tokens,
        word: wordFor(diffs, lineIndex, line),
      });
    });
  });

  return rows;
}

function splitCell(
  line: HunkLine | undefined,
  absoluteLineIndex: number,
  tokenIndex: number,
  side: "old" | "new",
  tokens: readonly (readonly TokenSpan[] | null)[] | null,
  diffs: Map<number, WordDiff>,
): SplitCell | null {
  if (!line) {
    return null;
  }

  return {
    type: line.type,
    content: line.content,
    lineNumber: side === "old" ? line.oldLine : line.newLine,
    tokens: tokens?.[tokenIndex] ?? null,
    word: line.type === "context" ? null : wordFor(diffs, absoluteLineIndex, line),
  };
}

function buildSplitRows(
  hunks: readonly Hunk[],
  highlights: readonly HunkHighlight[] | null,
): DiffRow[] {
  const rows: DiffRow[] = [];

  hunks.forEach((hunk, hunkIndex) => {
    rows.push(hunkRow(hunk, hunkIndex));
    const diffs = wordDiffsForHunk(hunk);
    const highlight = highlights?.[hunkIndex] ?? null;

    const oldTokenIndices = new Map<number, number>();
    let oldCount = 0;
    const newTokenIndices = new Map<number, number>();
    let newCount = 0;
    hunk.lines.forEach((line, lineIndex) => {
      if (line.type !== "add") {
        oldTokenIndices.set(lineIndex, oldCount);
        oldCount++;
      }
      if (line.type !== "delete") {
        newTokenIndices.set(lineIndex, newCount);
        newCount++;
      }
    });

    const blocksByDeleteStart = new Map(
      changeBlocks(hunk).map((block) => [block.deletedStart, block] as const),
    );

    let index = 0;
    while (index < hunk.lines.length) {
      const line = hunk.lines[index];
      if (!line) {
        break;
      }

      if (line.type === "context") {
        rows.push({
          kind: "split",
          key: `h${hunkIndex}l${index}`,
          left: splitCell(
            line,
            index,
            oldTokenIndices.get(index) ?? 0,
            "old",
            highlight?.old ?? null,
            diffs,
          ),
          right: splitCell(
            line,
            index,
            newTokenIndices.get(index) ?? 0,
            "new",
            highlight?.new ?? null,
            diffs,
          ),
        });
        index++;
        continue;
      }

      const block = blocksByDeleteStart.get(index);
      if (block) {
        let oldIndex = oldTokenIndices.get(block.deletedStart) ?? 0;
        let newIndex = newTokenIndices.get(block.addedStart) ?? 0;

        for (const pair of block.alignment) {
          const deletedLineIndex =
            pair.deleted !== undefined
              ? block.deletedStart + pair.deleted
              : undefined;
          const addedLineIndex =
            pair.added !== undefined ? block.addedStart + pair.added : undefined;
          const deleted =
            deletedLineIndex !== undefined
              ? hunk.lines[deletedLineIndex]
              : undefined;
          const added =
            addedLineIndex !== undefined ? hunk.lines[addedLineIndex] : undefined;

          rows.push({
            kind: "split",
            key: `h${hunkIndex}l${lineKeyPart(deletedLineIndex, addedLineIndex)}`,
            left: splitCell(
              deleted,
              deletedLineIndex ?? -1,
              oldIndex,
              "old",
              highlight?.old ?? null,
              diffs,
            ),
            right: splitCell(
              added,
              addedLineIndex ?? -1,
              newIndex,
              "new",
              highlight?.new ?? null,
              diffs,
            ),
          });

          if (deleted) {
            oldIndex++;
          }
          if (added) {
            newIndex++;
          }
        }

        index = block.addedStart + block.addedCount;
        continue;
      }

      if (line.type === "add") {
        rows.push({
          kind: "split",
          key: `h${hunkIndex}l${index}`,
          left: null,
          right: splitCell(
            line,
            index,
            newTokenIndices.get(index) ?? 0,
            "new",
            highlight?.new ?? null,
            diffs,
          ),
        });
      } else {
        rows.push({
          kind: "split",
          key: `h${hunkIndex}l${index}`,
          left: splitCell(
            line,
            index,
            oldTokenIndices.get(index) ?? 0,
            "old",
            highlight?.old ?? null,
            diffs,
          ),
          right: null,
        });
      }
      index++;
    }
  });

  return rows;
}

function lineKeyPart(
  deletedLineIndex: number | undefined,
  addedLineIndex: number | undefined,
): string {
  return `${deletedLineIndex ?? "x"}-${addedLineIndex ?? "x"}`;
}

export function buildDiffRows(
  hunks: readonly Hunk[],
  mode: DiffViewMode,
  highlights: readonly HunkHighlight[] | null = null,
): DiffRow[] {
  return mode === "side-by-side"
    ? buildSplitRows(hunks, highlights)
    : buildUnifiedRows(hunks, highlights);
}

export function wordDiffSegments(
  text: string,
  tokens: readonly TokenSpan[] | null,
  ranges: readonly WordRange[] | null,
): {
  readonly text: string;
  readonly style?: Readonly<Record<string, string>>;
  readonly highlighted: boolean;
}[] {
  const source =
    tokens && tokens.length > 0
      ? tokens
      : [{ content: text, style: undefined } as TokenSpan];
  const total = source.reduce((length, token) => length + token.content.length, 0);
  const safeRanges = ranges ?? [];

  if (total !== text.length) {
    return [{ text, highlighted: false }];
  }

  const segments: {
    text: string;
    style?: Readonly<Record<string, string>>;
    highlighted: boolean;
  }[] = [];
  let offset = 0;

  for (const token of source) {
    const start = offset;
    const end = offset + token.content.length;
    let position = start;

    for (const range of safeRanges) {
      if (range.end <= start || range.start >= end) {
        continue;
      }

      const rangeStart = Math.max(range.start, start);
      const rangeEnd = Math.min(range.end, end);

      if (rangeStart > position) {
        segments.push({
          text: text.slice(position, rangeStart),
          ...(token.style ? { style: token.style } : {}),
          highlighted: false,
        });
      }
      segments.push({
        text: text.slice(rangeStart, rangeEnd),
        ...(token.style ? { style: token.style } : {}),
        highlighted: true,
      });
      position = rangeEnd;
    }

    if (position < end) {
      segments.push({
        text: text.slice(position, end),
        ...(token.style ? { style: token.style } : {}),
        highlighted: false,
      });
    }

    offset = end;
  }

  return segments;
}

