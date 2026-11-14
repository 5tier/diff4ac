import type { GitGateway } from "../git/gateway";
import type { ChangeSet } from "../types";
import {
  buildChangeFiles,
  changeSetTotals,
  emptyTreeRef,
  parseNameStatus,
  parseUnstagedDeletions,
  parseUntracked,
  type ChangeFileOptions,
  type FileStatusRecord,
} from "./files";
import { pairPendingRenames, type PendingRename } from "./pending-renames";

function renameRecord(rename: PendingRename): FileStatusRecord {
  return {
    path: rename.newPath,
    oldPath: rename.oldPath,
    status: "renamed",
    pairedRename: true,
    similarity: rename.similarity,
  };
}

export async function buildPendingChangeSet(
  git: GitGateway,
  options: ChangeFileOptions = {},
): Promise<ChangeSet> {
  const hasHead = await git.hasHead();
  const baseRef = hasHead ? "HEAD" : await emptyTreeRef(git);
  const headRev = hasHead
    ? (await git.text(["rev-parse", "HEAD"])).trim()
    : null;

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
  const unstagedDeletions = new Set(parseUnstagedDeletions(statusOutput));
  const deleted = records.filter(
    (record) =>
      record.status === "deleted" &&
      !record.oldPath &&
      unstagedDeletions.has(record.path),
  );
  const pendingRenames = await pairPendingRenames(git, deleted, untracked);

  const renamedFrom = new Set(
    pendingRenames.map((rename) => rename.oldPath),
  );
  const renamedTo = new Map(
    pendingRenames.map((rename) => [rename.newPath, rename]),
  );

  const byPath = new Map<string, FileStatusRecord>();
  for (const record of records) {
    if (!renamedFrom.has(record.path)) {
      byPath.set(record.path, record);
    }
  }
  for (const path of untracked) {
    if (!renamedTo.has(path) && !byPath.has(path)) {
      byPath.set(path, { path, status: "untracked" });
    }
  }
  for (const rename of pendingRenames) {
    byPath.set(rename.newPath, renameRecord(rename));
  }

  const files = await buildChangeFiles(
    git,
    { baseRef, oldRev: headRev, newRev: "worktree" },
    [...byPath.values()],
    options,
  );

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
