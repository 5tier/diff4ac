export interface RenameCandidate {
  readonly path: string;
  readonly hash: string;
  readonly size: number;
  readonly content?: Uint8Array | null;
}

export interface RenamePair {
  readonly oldPath: string;
  readonly newPath: string;
  readonly similarity: number;
}

export interface RenamePairingOptions {
  readonly minSimilarity?: number;
  readonly maxSimilarityBytes?: number;
  readonly maxSimilarityComparisons?: number;
}

export const DEFAULT_RENAME_MIN_SIMILARITY = 0.5;
export const DEFAULT_RENAME_MAX_SIMILARITY_BYTES = 1_000_000;
export const DEFAULT_RENAME_MAX_SIMILARITY_COMPARISONS = 10_000;

export function isBinaryContent(content: Uint8Array): boolean {
  for (const byte of content) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function edgeSimilarity(left: Uint8Array, right: Uint8Array): number {
  const total = Math.max(left.byteLength, right.byteLength);
  if (total === 0) {
    return 1;
  }

  const limit = Math.min(left.byteLength, right.byteLength);
  let prefix = 0;
  while (prefix < limit && left[prefix] === right[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < limit - prefix &&
    left[left.byteLength - 1 - suffix] === right[right.byteLength - 1 - suffix]
  ) {
    suffix++;
  }

  return (prefix + suffix) / total;
}

function lineWeights(
  text: string,
): Map<string, { count: number; weight: number }> {
  const weights = new Map<string, { count: number; weight: number }>();
  for (const line of text.split("\n")) {
    const current = weights.get(line) ?? { count: 0, weight: line.length + 1 };
    current.count++;
    weights.set(line, current);
  }
  return weights;
}

function lineSimilarity(left: string, right: string): number {
  const oldLines = left.split("\n");
  const newLines = right.split("\n");
  const weights = lineWeights(left);
  let commonWeight = 0;

  for (const line of newLines) {
    const entry = weights.get(line);
    if (entry && entry.count > 0) {
      entry.count--;
      commonWeight += entry.weight;
    }
  }

  const oldWeight = oldLines.reduce((sum, line) => sum + line.length + 1, 0);
  const newWeight = newLines.reduce((sum, line) => sum + line.length + 1, 0);
  const total = Math.max(oldWeight, newWeight);
  return total === 0 ? 1 : commonWeight / total;
}

export function similarityRatio(
  oldContent: Uint8Array,
  newContent: Uint8Array,
): number {
  if (bytesEqual(oldContent, newContent)) {
    return 1;
  }
  if (oldContent.byteLength === 0 || newContent.byteLength === 0) {
    return 0;
  }

  if (isBinaryContent(oldContent) || isBinaryContent(newContent)) {
    return edgeSimilarity(oldContent, newContent);
  }

  const decoder = new TextDecoder();
  const left = decoder.decode(oldContent);
  const right = decoder.decode(newContent);
  const oldLines = left.split("\n").length;
  const newLines = right.split("\n").length;

  if (oldLines <= 1 || newLines <= 1) {
    return edgeSimilarity(oldContent, newContent);
  }

  return lineSimilarity(left, right);
}

function comparePaths(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

interface ScoredPair {
  readonly oldPath: string;
  readonly newPath: string;
  readonly similarity: number;
}

export function pairRenames(
  deletions: readonly RenameCandidate[],
  additions: readonly RenameCandidate[],
  options: RenamePairingOptions = {},
): RenamePair[] {
  const minSimilarity =
    options.minSimilarity ?? DEFAULT_RENAME_MIN_SIMILARITY;
  const maxSimilarityBytes =
    options.maxSimilarityBytes ?? DEFAULT_RENAME_MAX_SIMILARITY_BYTES;
  const maxComparisons =
    options.maxSimilarityComparisons ??
    DEFAULT_RENAME_MAX_SIMILARITY_COMPARISONS;

  const allowSimilarity =
    deletions.length * additions.length <= maxComparisons;
  const scored: ScoredPair[] = [];

  for (const deletion of deletions) {
    for (const addition of additions) {
      if (deletion.hash === addition.hash) {
        scored.push({
          oldPath: deletion.path,
          newPath: addition.path,
          similarity: 1,
        });
        continue;
      }

      if (!allowSimilarity) {
        continue;
      }
      if (
        deletion.size > maxSimilarityBytes ||
        addition.size > maxSimilarityBytes ||
        !deletion.content ||
        !addition.content
      ) {
        continue;
      }

      const similarity = similarityRatio(
        deletion.content,
        addition.content,
      );
      if (similarity >= minSimilarity) {
        scored.push({
          oldPath: deletion.path,
          newPath: addition.path,
          similarity,
        });
      }
    }
  }

  scored.sort((left, right) => {
    if (left.similarity !== right.similarity) {
      return right.similarity - left.similarity;
    }
    const byOldPath = comparePaths(left.oldPath, right.oldPath);
    return byOldPath === 0
      ? comparePaths(left.newPath, right.newPath)
      : byOldPath;
  });

  const usedDeletions = new Set<string>();
  const usedAdditions = new Set<string>();
  const pairs: RenamePair[] = [];

  for (const candidate of scored) {
    if (
      usedDeletions.has(candidate.oldPath) ||
      usedAdditions.has(candidate.newPath)
    ) {
      continue;
    }
    usedDeletions.add(candidate.oldPath);
    usedAdditions.add(candidate.newPath);
    pairs.push(candidate);
  }

  pairs.sort((left, right) => comparePaths(left.oldPath, right.oldPath));
  return pairs;
}
