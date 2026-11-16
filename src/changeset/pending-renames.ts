import type { GitGateway } from "../git/gateway";
import {
  gitBlobHash,
  objectFormat,
  readContentAtRev,
} from "./objects";
import type { FileStatusRecord } from "./parse";
import {
  pairRenames,
  type RenameCandidate,
  type RenamePair,
} from "./rename-pairing";

export interface PendingRename {
  readonly oldPath: string;
  readonly newPath: string;
  readonly similarity: number;
}

async function candidateFor(
  git: GitGateway,
  path: string,
  rev: string,
  format: "sha1" | "sha256",
): Promise<RenameCandidate | null> {
  const content = await readContentAtRev(git, rev, path);
  if (!content) {
    return null;
  }

  return {
    path,
    hash: gitBlobHash(content, format),
    size: content.byteLength,
    content,
  };
}

async function candidatesFor(
  git: GitGateway,
  paths: readonly string[],
  rev: string,
  format: "sha1" | "sha256",
): Promise<RenameCandidate[]> {
  const candidates: RenameCandidate[] = [];
  for (const path of paths) {
    const candidate = await candidateFor(git, path, rev, format);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

export async function pairPendingRenames(
  git: GitGateway,
  deletions: readonly FileStatusRecord[],
  untracked: readonly string[],
): Promise<PendingRename[]> {
  if (deletions.length === 0 || untracked.length === 0) {
    return [];
  }

  const format = await objectFormat(git);
  const oldCandidates = await candidatesFor(
    git,
    deletions.map((record) => record.path),
    "index",
    format,
  );
  const newCandidates = await candidatesFor(
    git,
    untracked,
    "worktree",
    format,
  );

  const pairs: RenamePair[] = pairRenames(oldCandidates, newCandidates);
  return pairs.map((pair) => ({
    oldPath: pair.oldPath,
    newPath: pair.newPath,
    similarity: pair.similarity,
  }));
}
