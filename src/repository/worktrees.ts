import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { countPendingFiles } from "../changeset/files";
import { GitGateway } from "../git/gateway";
import type { WorktreeList, WorktreeSummary } from "../types";

export class UnknownWorktreeError extends Error {
  constructor(path: string) {
    super(`worktree "${path}" was not found in this Repository`);
    this.name = "UnknownWorktreeError";
  }
}

interface WorktreeRecord {
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly prunable: boolean;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function parseWorktreeRecord(fields: readonly string[]): WorktreeRecord | null {
  let path = "";
  let head = "";
  let branch: string | null = null;
  let detached = false;
  let bare = false;
  let prunable = false;

  for (const field of fields) {
    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? "" : field.slice(separator + 1);

    switch (key) {
      case "worktree":
        path = value;
        break;
      case "HEAD":
        head = value;
        break;
      case "branch":
        branch = value.replace(/^refs\/heads\//, "");
        break;
      case "detached":
        detached = true;
        break;
      case "bare":
        bare = true;
        break;
      case "prunable":
        prunable = true;
        break;
    }
  }

  if (!path) {
    return null;
  }

  return {
    path,
    head,
    branch: detached ? null : branch,
    bare,
    prunable,
  };
}

function parseWorktreeList(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let fields: string[] = [];

  const flush = () => {
    if (fields.length === 0) {
      return;
    }
    const record = parseWorktreeRecord(fields);
    if (record) {
      records.push(record);
    }
    fields = [];
  };

  for (const token of output.split("\0")) {
    if (token === "") {
      flush();
    } else {
      fields.push(token);
    }
  }
  flush();

  return records;
}

async function readWorktreeRecords(git: GitGateway): Promise<WorktreeRecord[]> {
  const output = await git.text(["worktree", "list", "--porcelain", "-z"]);
  return parseWorktreeList(output);
}

async function pendingCount(path: string): Promise<number> {
  const worktreeGit = await GitGateway.open(path);
  const status = await worktreeGit.text([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return countPendingFiles(status);
}

export async function listWorktrees(git: GitGateway): Promise<WorktreeList> {
  const records = await readWorktreeRecords(git);
  const currentPath = canonicalPath(git.worktreeRoot);

  const worktrees: WorktreeSummary[] = await Promise.all(
    records
      .filter((record) => !record.bare && !record.prunable)
      .map(async (record) => {
        const path = canonicalPath(record.path);
        return {
          path,
          branch: record.branch,
          head: record.head,
          shortHead: record.head.slice(0, 7),
          pendingCount: await pendingCount(record.path),
          current: path === currentPath,
        };
      }),
  );

  return { worktrees };
}

export async function openWorktree(
  git: GitGateway,
  path: string,
): Promise<GitGateway> {
  const records = await readWorktreeRecords(git);
  const requested = canonicalPath(path);
  const record = records.find(
    (candidate) => canonicalPath(candidate.path) === requested,
  );

  if (!record || record.bare || record.prunable) {
    throw new UnknownWorktreeError(path);
  }

  return GitGateway.open(record.path);
}
