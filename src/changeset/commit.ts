import type { GitGateway } from "../git/gateway";
import type { CompiledAgentPattern } from "../agents";
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
  type ChangeFileOptions,
} from "./files";

export interface CommitFiles {
  readonly files: readonly ChangeFile[];
  readonly totals: ChangeTotals;
}

export async function buildCommitFiles(
  git: GitGateway,
  commit: CommitSummary,
  options: ChangeFileOptions = {},
): Promise<CommitFiles> {
  const parent = await firstParent(git, commit.hash);
  const baseRef = parent ?? (await emptyTreeRef(git));
  const files = await buildChangeFilesForRange(
    git,
    {
      baseRef,
      targetRef: commit.hash,
      oldRev: parent,
      newRev: commit.hash,
    },
    options,
  );

  return { files, totals: changeSetTotals(files) };
}

export interface CommitChangeSetOptions extends ChangeFileOptions {
  readonly agentPatterns?: readonly CompiledAgentPattern[];
}

export async function buildCommitChangeSet(
  git: GitGateway,
  rev: string,
  options: CommitChangeSetOptions = {},
): Promise<ChangeSet> {
  const commit = await readCommit(git, rev, {
    agentPatterns: options.agentPatterns,
  });
  const { files, totals } = await buildCommitFiles(git, commit, options);

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
