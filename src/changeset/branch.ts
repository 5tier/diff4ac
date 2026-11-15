import type { GitGateway } from "../git/gateway";
import {
  detectBaseBranch,
  readBranch,
  UnknownBranchError,
} from "../repository/branches";
import type { ChangeSet, Selection } from "../types";
import {
  buildChangeFilesForRange,
  changeSetTotals,
  type ChangeFileOptions,
  type DiffRange,
} from "./files";

export interface BranchScope {
  readonly selection: Selection;
  readonly worktree: ChangeSet["worktree"];
  readonly range: DiffRange;
}

export async function resolveBranchScope(
  git: GitGateway,
  branchName: string,
  baseBranchOverride: string | null = null,
): Promise<BranchScope> {
  const branch = await readBranch(git, branchName);
  if (!branch) {
    throw new UnknownBranchError(branchName);
  }

  const baseBranch = await detectBaseBranch(git, baseBranchOverride);
  if (!baseBranch) {
    throw new Error(
      "could not detect a Base Branch (origin/HEAD, main or master)",
    );
  }

  const mergeBase = (
    await git.text(["merge-base", baseBranch.ref, `refs/heads/${branch.name}`])
  ).trim();

  return {
    selection: { kind: "branch", branch, baseBranch },
    worktree: {
      path: git.worktreeRoot,
      branch: await git.currentBranch(),
    },
    range: {
      baseRef: mergeBase,
      targetRef: branch.hash,
      oldRev: mergeBase,
      newRev: branch.hash,
    },
  };
}

export async function buildBranchChangeSet(
  git: GitGateway,
  branchName: string,
  baseBranchOverride: string | null = null,
  options: ChangeFileOptions = {},
): Promise<ChangeSet> {
  const { selection, worktree, range } = await resolveBranchScope(
    git,
    branchName,
    baseBranchOverride,
  );
  const files = await buildChangeFilesForRange(git, range, options);

  return {
    selection,
    worktree,
    files,
    totals: changeSetTotals(files),
  };
}
