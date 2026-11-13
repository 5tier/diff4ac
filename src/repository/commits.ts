import type { GitGateway } from "../git/gateway";
import type { CommitList, CommitSummary } from "../types";

const FIELD = "\x1f";
const RECORD = "\x1e";
const COMMIT_FORMAT = [
  "%H",
  "%h",
  "%an",
  "%ae",
  "%cI",
  "%P",
  "%s",
].join(`%x1f`) + `%x1e`;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeDate(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 0) {
    return "in the future";
  }
  if (seconds < 45) {
    return "just now";
  }

  const units: readonly (readonly [number, string])[] = [
    [YEAR, "year"],
    [MONTH, "month"],
    [WEEK, "week"],
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
  ];

  for (const [size, label] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) {
      return `${count} ${label}${count === 1 ? "" : "s"} ago`;
    }
  }

  return `${seconds} seconds ago`;
}

function parseCommitLog(output: string, now: Date): CommitSummary[] {
  const commits: CommitSummary[] = [];

  for (const record of output.split(RECORD)) {
    const trimmed = record.replace(/^\n+|\n+$/g, "");
    if (!trimmed) {
      continue;
    }

    const [hash, shortHash, name, email, committedAt, parents, message] =
      trimmed.split(FIELD);
    if (!hash || !shortHash || !committedAt) {
      continue;
    }

    commits.push({
      hash,
      shortHash,
      message: message ?? "",
      author: {
        name: name ?? "",
        email: email ?? "",
      },
      committedAt,
      relativeDate: relativeDate(committedAt, now),
      firstParent: parents?.split(" ").filter(Boolean)[0] ?? null,
    });
  }

  return commits;
}

export interface ListCommitsOptions {
  readonly limit?: number;
  readonly now?: Date;
}

export async function listCommits(
  git: GitGateway,
  options: ListCommitsOptions = {},
): Promise<CommitList> {
  const worktree = {
    path: git.worktreeRoot,
    branch: await git.currentBranch(),
  };

  if (!(await git.hasHead())) {
    return { worktree, commits: [] };
  }

  const args = ["log", `--format=${COMMIT_FORMAT}`];
  if (options.limit !== undefined) {
    args.push("-n", String(options.limit));
  }

  const output = await git.text(args);
  return {
    worktree,
    commits: parseCommitLog(output, options.now ?? new Date()),
  };
}

export async function readCommit(
  git: GitGateway,
  rev: string,
  options: { readonly now?: Date } = {},
): Promise<CommitSummary> {
  const output = await git.text([
    "log",
    "-1",
    `--format=${COMMIT_FORMAT}`,
    rev,
    "--",
  ]);
  const commit = parseCommitLog(output, options.now ?? new Date())[0];

  if (!commit) {
    throw new Error(`commit "${rev}" was not found`);
  }

  return commit;
}

export async function firstParent(
  git: GitGateway,
  rev: string,
): Promise<string | null> {
  const output = await git.text(["rev-list", "--parents", "-n", "1", rev]);
  const fields = output.trim().split(/\s+/);
  return fields[1] ?? null;
}
