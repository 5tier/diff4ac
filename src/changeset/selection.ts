import type { CommitSummary } from "../types";

export function isContiguousCommitSelection(
  selected: readonly CommitSummary[],
): boolean {
  if (selected.length <= 1) {
    return true;
  }

  const byHash = new Map(selected.map((commit) => [commit.hash, commit] as const));
  if (byHash.size !== selected.length) {
    return false;
  }

  const claimedParents = new Set<string>();
  for (const commit of selected) {
    if (commit.firstParent && byHash.has(commit.firstParent)) {
      if (claimedParents.has(commit.firstParent)) {
        return false;
      }
      claimedParents.add(commit.firstParent);
    }
  }

  const heads = selected.filter((commit) => !claimedParents.has(commit.hash));
  if (heads.length !== 1) {
    return false;
  }

  const visited = new Set<string>();
  let current: CommitSummary | undefined = heads[0];
  while (current) {
    if (visited.has(current.hash)) {
      return false;
    }
    visited.add(current.hash);

    const parentHash = current.firstParent;
    current = parentHash ? byHash.get(parentHash) : undefined;
  }

  return visited.size === selected.length;
}
