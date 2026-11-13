import type { GitGateway } from "../git/gateway";
import { firstParent, readCommit } from "../repository/commits";
import type { ChangeSet } from "../types";
import {
  buildChangeFiles,
  changeSetTotals,
  emptyTreeRef,
  parseNameStatus,
} from "./files";

export async function buildCommitChangeSet(
  git: GitGateway,
  rev: string,
): Promise<ChangeSet> {
  const commit = await readCommit(git, rev);
  const parent = await firstParent(git, commit.hash);
  const baseRef = parent ?? (await emptyTreeRef(git));

  const nameStatusOutput = await git.text([
    "diff",
    baseRef,
    commit.hash,
    "--name-status",
    "-z",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  const files = await buildChangeFiles(
    git,
    { baseRef, targetRef: commit.hash },
    parseNameStatus(nameStatusOutput),
  );

  return {
    selection: { kind: "commit", commit },
    worktree: {
      path: git.worktreeRoot,
      branch: await git.currentBranch(),
    },
    files,
    totals: changeSetTotals(files),
  };
}
