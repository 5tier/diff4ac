import type { Hunk } from "../types";

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export interface ChangeMarks {
  readonly added: readonly LineRange[];
  readonly modified: readonly LineRange[];
  readonly deletedAfter: readonly number[];
}

export interface BeforeChangeMarks {
  readonly removed: readonly LineRange[];
  readonly modified: readonly LineRange[];
  readonly addedAfter: readonly number[];
}

interface Block {
  readonly adds: { readonly newLine: number | null }[];
  readonly deletes: { readonly oldLine: number | null }[];
  readonly newStart: number;
  readonly oldStart: number;
}

function blockRange(
  lines: readonly { readonly newLine: number | null }[],
  fallbackStart: number,
): LineRange | null {
  if (lines.length === 0) {
    return null;
  }
  const start = lines[0]?.newLine ?? fallbackStart;
  const end = lines.at(-1)?.newLine ?? start + lines.length - 1;
  return { start, end };
}

function oldBlockRange(
  lines: readonly { readonly oldLine: number | null }[],
  fallbackStart: number,
): LineRange | null {
  if (lines.length === 0) {
    return null;
  }
  const start = lines[0]?.oldLine ?? fallbackStart;
  const end = lines.at(-1)?.oldLine ?? start + lines.length - 1;
  return { start, end };
}

function eachBlock(
  hunks: readonly Hunk[],
  visit: (block: Block) => void,
): void {
  for (const hunk of hunks) {
    let nextNew = hunk.newStart;
    let nextOld = hunk.oldStart;
    let block: {
      adds: { readonly newLine: number | null }[];
      deletes: { readonly oldLine: number | null }[];
      newStart: number;
      oldStart: number;
    } | null = null;

    const flush = () => {
      if (block) {
        visit(block);
        block = null;
      }
    };

    for (const line of hunk.lines) {
      if (line.type === "context") {
        flush();
        nextNew++;
        nextOld++;
        continue;
      }

      if (!block) {
        block = { adds: [], deletes: [], newStart: nextNew, oldStart: nextOld };
      }

      if (line.type === "add") {
        block.adds.push({ newLine: line.newLine });
        nextNew++;
      } else {
        block.deletes.push({ oldLine: line.oldLine });
        nextOld++;
      }
    }
    flush();
  }
}

/** Marks on the new-side line numbers of a Change File's hunks. */
export function changeMarks(hunks: readonly Hunk[]): ChangeMarks {
  const added: LineRange[] = [];
  const modified: LineRange[] = [];
  const deletedAfter: number[] = [];

  eachBlock(hunks, (block) => {
    if (block.adds.length > 0 && block.deletes.length > 0) {
      const range = blockRange(block.adds, block.newStart);
      if (range) {
        modified.push(range);
      }
      return;
    }
    if (block.adds.length > 0) {
      const range = blockRange(block.adds, block.newStart);
      if (range) {
        added.push(range);
      }
      return;
    }
    deletedAfter.push(block.newStart - 1);
  });

  return { added, modified, deletedAfter };
}

/** The same marks mirrored onto old-side line numbers. */
export function beforeChangeMarks(
  hunks: readonly Hunk[],
): BeforeChangeMarks {
  const removed: LineRange[] = [];
  const modified: LineRange[] = [];
  const addedAfter: number[] = [];

  eachBlock(hunks, (block) => {
    if (block.adds.length > 0 && block.deletes.length > 0) {
      const range = oldBlockRange(block.deletes, block.oldStart);
      if (range) {
        modified.push(range);
      }
      return;
    }
    if (block.deletes.length > 0) {
      const range = oldBlockRange(block.deletes, block.oldStart);
      if (range) {
        removed.push(range);
      }
      return;
    }
    addedAfter.push(block.oldStart - 1);
  });

  return { removed, modified, addedAfter };
}
