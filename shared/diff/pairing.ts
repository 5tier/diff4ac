import type { Hunk } from "../types";
import { tokenSimilarity, wordDiff, type WordDiff } from "./word-diff";

export interface LinePair {
  readonly deleted?: number;
  readonly added?: number;
}

export interface ChangeBlock {
  readonly deletedStart: number;
  readonly deletedCount: number;
  readonly addedStart: number;
  readonly addedCount: number;
  readonly alignment: readonly LinePair[];
}

const PAIR_BIAS = 0.001;
const MAX_ALIGNMENT_CELLS = 20_000;

function positionalAlignment(n: number, m: number): LinePair[] {
  const paired = Math.min(n, m);
  const alignment: LinePair[] = [];
  for (let index = 0; index < paired; index++) {
    alignment.push({ deleted: index, added: index });
  }
  for (let index = paired; index < n; index++) {
    alignment.push({ deleted: index });
  }
  for (let index = paired; index < m; index++) {
    alignment.push({ added: index });
  }
  return alignment;
}

export function alignChangeLines(
  deleted: readonly string[],
  added: readonly string[],
): LinePair[] {
  const n = deleted.length;
  const m = added.length;
  if (n === 0 && m === 0) {
    return [];
  }
  if (n * m > MAX_ALIGNMENT_CELLS) {
    return positionalAlignment(n, m);
  }

  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const pair =
        PAIR_BIAS +
        tokenSimilarity(deleted[i] ?? "", added[j] ?? "") +
        (table[i + 1]?.[j + 1] ?? 0);
      table[i]![j] = Math.max(
        pair,
        table[i + 1]?.[j] ?? 0,
        table[i]?.[j + 1] ?? 0,
      );
    }
  }

  const alignment: LinePair[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    const pair =
      PAIR_BIAS +
      tokenSimilarity(deleted[i] ?? "", added[j] ?? "") +
      (table[i + 1]?.[j + 1] ?? 0);
    const best = table[i]?.[j] ?? 0;

    if (Math.abs(best - pair) < 1e-9) {
      alignment.push({ deleted: i, added: j });
      i++;
      j++;
    } else if (Math.abs(best - (table[i + 1]?.[j] ?? 0)) < 1e-9) {
      alignment.push({ deleted: i });
      i++;
    } else {
      alignment.push({ added: j });
      j++;
    }
  }

  while (i < n) {
    alignment.push({ deleted: i });
    i++;
  }
  while (j < m) {
    alignment.push({ added: j });
    j++;
  }

  return alignment;
}

export function changeBlocks(hunk: Hunk): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  const lines = hunk.lines;
  let index = 0;

  while (index < lines.length) {
    if (lines[index]?.type !== "delete") {
      index++;
      continue;
    }

    const deletedStart = index;
    while (index < lines.length && lines[index]?.type === "delete") {
      index++;
    }
    const deletedCount = index - deletedStart;

    const addedStart = index;
    while (index < lines.length && lines[index]?.type === "add") {
      index++;
    }
    const addedCount = index - addedStart;

    if (addedCount === 0) {
      continue;
    }

    const deleted = lines
      .slice(deletedStart, deletedStart + deletedCount)
      .map((line) => line.content);
    const added = lines
      .slice(addedStart, addedStart + addedCount)
      .map((line) => line.content);

    blocks.push({
      deletedStart,
      deletedCount,
      addedStart,
      addedCount,
      alignment: alignChangeLines(deleted, added),
    });
  }

  return blocks;
}

export function wordDiffsForHunk(hunk: Hunk): Map<number, WordDiff> {
  const diffs = new Map<number, WordDiff>();
  const lines = hunk.lines;

  for (const block of changeBlocks(hunk)) {
    for (const pair of block.alignment) {
      if (pair.deleted === undefined || pair.added === undefined) {
        continue;
      }
      const deleted = lines[block.deletedStart + pair.deleted];
      const added = lines[block.addedStart + pair.added];
      if (!deleted || !added) {
        continue;
      }

      const diff = wordDiff(deleted.content, added.content);
      diffs.set(block.deletedStart + pair.deleted, diff);
      diffs.set(block.addedStart + pair.added, diff);
    }
  }

  return diffs;
}
