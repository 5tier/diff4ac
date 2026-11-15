import type { GitGateway } from "../git/gateway";
import {
  readBranch,
  requireBaseBranch,
  UnknownBranchError,
} from "../repository/branches";
import type { ChangeSet, Selection } from "../../shared/types";
import {
  buildChangeFilesForRange,
  type ChangeFileOptions,
  type DiffRange,
} from "./files";
import { changeSetTotals } from "./totals";

export class NoMergeBaseError extends Error {
  constructor(branch: string, base: string) {
    super(`branch ${branch} shares no history with ${base}`);
    this.name = "NoMergeBaseError";
  }
}

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

  const baseBranch = await requireBaseBranch(git, baseBranchOverride);

  const mergeBaseResult = await git.run(
    ["merge-base", baseBranch.ref, `refs/heads/${branch.name}`],
    { allowExitCodes: [0, 1] },
  );
  if (mergeBaseResult.exitCode !== 0) {
    throw new NoMergeBaseError(branch.name, baseBranch.name);
  }
  const mergeBase = mergeBaseResult.stdout.toString("utf8").trim();

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
