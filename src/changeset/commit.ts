import type { GitGateway } from "../git/gateway";
import { firstParent, readCommit } from "../repository/commits";
import type {
  ChangeFile,
  ChangeSet,
  ChangeTotals,
  CommitSummary,
} from "../types";
import {
  buildChangeFilesForRange,
  changeSetTotals,
  emptyTreeRef,
} from "./files";

export interface CommitFiles {
  readonly files: readonly ChangeFile[];
  readonly totals: ChangeTotals;
}

export async function buildCommitFiles(
  git: GitGateway,
  commit: CommitSummary,
): Promise<CommitFiles> {
  const parent = await firstParent(git, commit.hash);
  const baseRef = parent ?? (await emptyTreeRef(git));
  const files = await buildChangeFilesForRange(git, {
    baseRef,
    targetRef: commit.hash,
  });

  return { files, totals: changeSetTotals(files) };
}

export async function buildCommitChangeSet(
  git: GitGateway,
  rev: string,
): Promise<ChangeSet> {
  const commit = await readCommit(git, rev);
  const { files, totals } = await buildCommitFiles(git, commit);

  return {
    selection: { kind: "commit", commit },
    worktree: {
      path: git.worktreeRoot,
      branch: await git.currentBranch(),
    },
    files,
    totals,
  };
}
