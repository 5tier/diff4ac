import {
  classifyAgent,
  DEFAULT_AGENT_PATTERNS,
  type CompiledAgentPattern,
} from "../agents";
import type { GitGateway } from "../git/gateway";
import { filterCommitsInTimeWindow } from "../time-windows";
import type { CommitList, CommitSummary, TimeWindow } from "../types";

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
  "%(trailers:only,unfold)",
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

function parseCommitLog(
  output: string,
  now: Date,
  patterns: readonly CompiledAgentPattern[],
): CommitSummary[] {
  const commits: CommitSummary[] = [];

  for (const record of output.split(RECORD)) {
    const trimmed = record.replace(/^\n+|\n+$/g, "");
    if (!trimmed) {
      continue;
    }

    const [
      hash,
      shortHash,
      name,
      email,
      committedAt,
      parents,
      message,
      trailersRaw,
    ] = trimmed.split(FIELD);
    if (!hash || !shortHash || !committedAt) {
      continue;
    }

    const authorName = name ?? "";
    const authorEmail = email ?? "";
    const trailers = (trailersRaw ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    commits.push({
      hash,
      shortHash,
      message: message ?? "",
      author: {
        name: authorName,
        email: authorEmail,
      },
      committedAt,
      relativeDate: relativeDate(committedAt, now),
      firstParent: parents?.split(" ").filter(Boolean)[0] ?? null,
      agent: classifyAgent(
        { authorName, authorEmail, trailers },
        patterns,
      ),
    });
  }

  return commits;
}

export interface ListCommitsOptions {
  readonly limit?: number;
  readonly now?: Date;
  readonly agentPatterns?: readonly CompiledAgentPattern[];
  readonly agent?: string;
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
  const commits = parseCommitLog(
    output,
    options.now ?? new Date(),
    options.agentPatterns ?? DEFAULT_AGENT_PATTERNS,
  );
  return {
    worktree,
    commits: options.agent
      ? commits.filter((commit) => commit.agent === options.agent)
      : commits,
  };
}

export async function listCommitsInWindow(
  git: GitGateway,
  window: Pick<TimeWindow, "start" | "end">,
  options: ListCommitsOptions = {},
): Promise<CommitList> {
  const list = await listCommits(git, options);
  return {
    worktree: list.worktree,
    commits: filterCommitsInTimeWindow(list.commits, window),
  };
}

export async function readCommit(
  git: GitGateway,
  rev: string,
  options: {
    readonly now?: Date;
    readonly agentPatterns?: readonly CompiledAgentPattern[];
  } = {},
): Promise<CommitSummary> {
  const output = await git.text([
    "log",
    "-1",
    `--format=${COMMIT_FORMAT}`,
    rev,
    "--",
  ]);
  const commit = parseCommitLog(
    output,
    options.now ?? new Date(),
    options.agentPatterns ?? DEFAULT_AGENT_PATTERNS,
  )[0];

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
