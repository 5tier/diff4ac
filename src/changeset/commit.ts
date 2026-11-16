import type { GitGateway } from "../git/gateway";
import type { CompiledAgentPattern } from "../agents";
import { firstParent, readCommit } from "../repository/commits";
import type {
  ChangeFile,
  ChangeSet,
  ChangeTotals,
  CommitSummary,
} from "../../shared/types";
import { buildChangeFilesForRange } from "./files";
import { emptyTreeRef } from "./objects";
import type { ChangeFileOptions, DiffRange } from "./types";
import { changeSetTotals } from "./totals";

export interface CommitFiles {
  readonly files: readonly ChangeFile[];
  readonly totals: ChangeTotals;
}

export async function resolveCommitRange(
  git: GitGateway,
  hash: string,
): Promise<DiffRange> {
  const parent = await firstParent(git, hash);
  return {
    baseRef: parent ?? (await emptyTreeRef(git)),
    targetRef: hash,
    oldRev: parent,
    newRev: hash,
  };
}

export async function buildCommitFiles(
  git: GitGateway,
  commit: CommitSummary,
  options: ChangeFileOptions = {},
): Promise<CommitFiles> {
  const range = await resolveCommitRange(git, commit.hash);
  const files = await buildChangeFilesForRange(git, range, options);

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
