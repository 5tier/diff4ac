import type { GitGateway } from "../git/gateway";
import {
  detectBaseBranch,
  readBranch,
  UnknownBranchError,
} from "../repository/branches";
import type { ChangeSet } from "../types";
import {
  buildChangeFiles,
  changeSetTotals,
  parseNameStatus,
} from "./files";

export async function buildBranchChangeSet(
  git: GitGateway,
  branchName: string,
): Promise<ChangeSet> {
  const branch = await readBranch(git, branchName);
  if (!branch) {
    throw new UnknownBranchError(branchName);
  }

  const baseBranch = await detectBaseBranch(git);
  if (!baseBranch) {
    throw new Error(
      "could not detect a Base Branch (origin/HEAD, main or master)",
    );
  }

  const mergeBase = (
    await git.text(["merge-base", baseBranch.ref, `refs/heads/${branch.name}`])
  ).trim();

  const nameStatusOutput = await git.text([
    "diff",
    mergeBase,
    branch.hash,
    "--name-status",
    "-z",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  const files = await buildChangeFiles(
    git,
    { baseRef: mergeBase, targetRef: branch.hash },
    parseNameStatus(nameStatusOutput),
  );

  return {
    selection: { kind: "branch", branch, baseBranch },
    worktree: {
      path: git.worktreeRoot,
      branch: await git.currentBranch(),
    },
    files,
    totals: changeSetTotals(files),
  };
}
