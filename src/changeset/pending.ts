import type { GitGateway } from "../git/gateway";
import type { ChangeSet } from "../types";
import {
  buildChangeFiles,
  changeSetTotals,
  emptyTreeRef,
  parseNameStatus,
  parseUntracked,
  type FileStatusRecord,
} from "./files";

export async function buildPendingChangeSet(
  git: GitGateway,
): Promise<ChangeSet> {
  const baseRef = (await git.hasHead()) ? "HEAD" : await emptyTreeRef(git);

  const [nameStatusOutput, statusOutput] = await Promise.all([
    git.text([
      "diff",
      baseRef,
      "--name-status",
      "-z",
      "--find-renames",
      "--no-color",
      "--no-ext-diff",
    ]),
    git.text(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);

  const records = parseNameStatus(nameStatusOutput);
  const untracked = parseUntracked(statusOutput);

  const byPath = new Map<string, FileStatusRecord>();
  for (const record of records) {
    byPath.set(record.path, record);
  }
  for (const path of untracked) {
    if (!byPath.has(path)) {
      byPath.set(path, { path, status: "untracked" });
    }
  }

  const files = await buildChangeFiles(git, { baseRef }, [...byPath.values()]);

  return {
    selection: { kind: "pending" },
    worktree: {
      path: git.worktreeRoot,
      branch: await git.currentBranch(),
    },
    files,
    totals: changeSetTotals(files),
  };
}
