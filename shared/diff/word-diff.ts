export interface WordRange {
  readonly start: number;
  readonly end: number;
}

export interface WordDiff {
  readonly removed: readonly WordRange[];
  readonly added: readonly WordRange[];
}

export interface WordToken {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TOKEN_PATTERN = /[\p{L}\p{N}_$]+|\s+|[^\s\p{L}\p{N}_$]/gu;

export function tokenizeLine(line: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const text = match[0];
    const start = match.index ?? 0;
    tokens.push({ text, start, end: start + text.length });
  }
  return tokens;
}

function lcsLength(left: readonly WordToken[], right: readonly WordToken[]): number {
  const n = left.length;
  const m = right.length;
  if (n === 0 || m === 0) {
    return 0;
  }

  let previous = new Array<number>(m + 1).fill(0);
  let current = new Array<number>(m + 1).fill(0);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      current[j] =
        left[i]?.text === right[j]?.text
          ? (previous[j + 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j + 1] ?? 0);
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }

  return previous[0] ?? 0;
}

export function tokenSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const leftTokens = tokenizeLine(left);
  const rightTokens = tokenizeLine(right);
  const longest = Math.max(leftTokens.length, rightTokens.length);
  if (longest === 0) {
    return 1;
  }
  return lcsLength(leftTokens, rightTokens) / longest;
}

function mergeRanges(ranges: readonly WordRange[]): WordRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: WordRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, range.end),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function unmatchedRanges(
  tokens: readonly WordToken[],
  matched: readonly boolean[],
): WordRange[] {
  const ranges: WordRange[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (matched[index]) {
      continue;
    }
    const token = tokens[index];
    if (!token) {
      continue;
    }
    ranges.push({ start: token.start, end: token.end });
  }
  return mergeRanges(ranges);
}

const MAX_WORD_DIFF_CELLS = 250_000;

export function wordDiff(oldLine: string, newLine: string): WordDiff {
  if (oldLine === newLine) {
    return { removed: [], added: [] };
  }

  const oldTokens = tokenizeLine(oldLine);
  const newTokens = tokenizeLine(newLine);

  if (oldTokens.length * newTokens.length > MAX_WORD_DIFF_CELLS) {
    return {
      removed: oldLine.length > 0 ? [{ start: 0, end: oldLine.length }] : [],
      added: newLine.length > 0 ? [{ start: 0, end: newLine.length }] : [],
    };
  }
  const oldMatched = new Array<boolean>(oldTokens.length).fill(false);
  const newMatched = new Array<boolean>(newTokens.length).fill(false);

  const n = oldTokens.length;
  const m = newTokens.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        oldTokens[i]?.text === newTokens[j]?.text
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTokens[i]?.text === newTokens[j]?.text) {
      oldMatched[i] = true;
      newMatched[j] = true;
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }

  return {
    removed: unmatchedRanges(oldTokens, oldMatched),
    added: unmatchedRanges(newTokens, newMatched),
  };
}
