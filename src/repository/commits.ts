import {
  classifyAgent,
  DEFAULT_AGENT_PATTERNS,
  type CompiledAgentPattern,
} from "../agents";
import {
  GIT_HEAVY_TIMEOUT_MS,
  type GitGateway,
} from "../git/gateway";
import { filterCommitsInTimeWindow } from "../../shared/time-windows";
import type {
  CommitList,
  CommitSummary,
  TimeWindow,
  WorktreeInfo,
} from "../../shared/types";

export class UnknownCommitError extends Error {
  constructor(readonly hash: string) {
    super(
      `commit ${hash.slice(0, 7)} was not found in this Repository`,
    );
    this.name = "UnknownCommitError";
  }
}

/**
 * Reject revisions that do not resolve to a commit in one `cat-file` call.
 * `^{commit}` also rejects blobs, trees and tags that do not peel to a commit.
 */
export async function assertCommitsExist(
  git: GitGateway,
  revs: readonly string[],
): Promise<void> {
  const unique = [...new Set(revs)];
  if (unique.length === 0) {
    return;
  }

  const input = unique.map((rev) => `${rev}^{commit}\n`).join("");
  const { stdout } = await git.run(["cat-file", "--batch-check"], {
    input,
    timeoutMs: GIT_HEAVY_TIMEOUT_MS,
  });
  const lines = stdout.toString("utf8").split("\n");

  unique.forEach((rev, index) => {
    const line = lines[index] ?? "";
    if (!line || line.endsWith(" missing")) {
      throw new UnknownCommitError(rev);
    }
  });
}

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

export const COMMIT_PAGE_SIZE = 500;

const WINDOW_MARGIN_MS = 24 * 60 * 60 * 1000;

let sinceAsFilterSupport: boolean | null = null;

/**
 * Test-only seam for old git builds; pass null to restore probing.
 * `--since-as-filter` exists from git 2.37.
 */
export function setSinceAsFilterSupport(supported: boolean | null): void {
  sinceAsFilterSupport = supported;
}

async function supportsSinceAsFilter(git: GitGateway): Promise<boolean> {
  if (sinceAsFilterSupport !== null) {
    return sinceAsFilterSupport;
  }

  try {
    await git.run([
      "log",
      "-1",
      "--since-as-filter=1970-01-01T00:00:00Z",
      "--format=%H",
    ]);
    sinceAsFilterSupport = true;
  } catch {
    // An unknown option fails before producing output; old git is the likely
    // cause, and falling back preserves the old unbounded behaviour.
    sinceAsFilterSupport = false;
  }
  return sinceAsFilterSupport;
}

export interface ListCommitsOptions {
  readonly limit?: number;
  readonly skip?: number;
  readonly now?: Date;
  readonly agentPatterns?: readonly CompiledAgentPattern[];
  readonly agent?: string;
}

async function commitHeader(
  git: GitGateway,
): Promise<{ worktree: WorktreeInfo; hasHead: boolean }> {
  const worktree = {
    path: git.worktreeRoot,
    branch: await git.currentBranch(),
  };
  return { worktree, hasHead: await git.hasHead() };
}

export async function listCommits(
  git: GitGateway,
  options: ListCommitsOptions = {},
): Promise<CommitList> {
  const { worktree, hasHead } = await commitHeader(git);
  if (!hasHead) {
    return { worktree, commits: [], hasMore: false };
  }

  const pageSize = Math.max(1, options.limit ?? COMMIT_PAGE_SIZE);
  const skip = Math.max(0, options.skip ?? 0);
  const args = ["log", `--format=${COMMIT_FORMAT}`];
  if (skip > 0) {
    args.push("--skip", String(skip));
  }
  // One extra record tells us whether another page exists.
  args.push("-n", String(pageSize + 1));

  const output = await git.text(args, {
    timeoutMs: GIT_HEAVY_TIMEOUT_MS,
    emptyOk: true,
  });
  const parsed = parseCommitLog(
    output,
    options.now ?? new Date(),
    options.agentPatterns ?? DEFAULT_AGENT_PATTERNS,
  );
  const hasMore = parsed.length > pageSize;
  const page = hasMore ? parsed.slice(0, pageSize) : parsed;
  const commits = options.agent
    ? page.filter((commit) => commit.agent === options.agent)
    : page;

  return { worktree, commits, hasMore };
}

export async function listCommitsInWindow(
  git: GitGateway,
  window: Pick<TimeWindow, "start" | "end">,
  options: ListCommitsOptions = {},
): Promise<CommitList> {
  const { worktree, hasHead } = await commitHeader(git);
  if (!hasHead) {
    return { worktree, commits: [], hasMore: false };
  }

  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  const args = ["log", `--format=${COMMIT_FORMAT}`];
  const sinceFilter = await supportsSinceAsFilter(git);
  if (sinceFilter) {
    if (!Number.isNaN(startMs)) {
      args.push(
        `--since-as-filter=${new Date(startMs - WINDOW_MARGIN_MS).toISOString()}`,
      );
    }
    if (!Number.isNaN(endMs)) {
      args.push(
        `--until=${new Date(endMs + WINDOW_MARGIN_MS).toISOString()}`,
      );
    }
  }

  const output = await git.text(args, {
    timeoutMs: GIT_HEAVY_TIMEOUT_MS,
    emptyOk: true,
  });
  let commits = parseCommitLog(
    output,
    options.now ?? new Date(),
    options.agentPatterns ?? DEFAULT_AGENT_PATTERNS,
  );
  if (options.agent) {
    commits = commits.filter((commit) => commit.agent === options.agent);
  }
  // --since-as-filter keeps walking past older commits (a merge tip can be
  // older than the window); the exact in-memory filter keeps results equal.
  commits = filterCommitsInTimeWindow(commits, window);

  return { worktree, commits, hasMore: false };
}

export async function readCommitsByHash(
  git: GitGateway,
  hashes: readonly string[],
  options: {
    readonly now?: Date;
    readonly agentPatterns?: readonly CompiledAgentPattern[];
  } = {},
): Promise<Map<string, CommitSummary>> {
  const unique = [...new Set(hashes)];
  if (unique.length === 0) {
    return new Map();
  }

  const output = await git.text(
    [
      "log",
      "--no-walk=unsorted",
    `--format=${COMMIT_FORMAT}`,
      ...unique,
    ],
    { timeoutMs: GIT_HEAVY_TIMEOUT_MS },
  );
  const commits = parseCommitLog(
    output,
    options.now ?? new Date(),
    options.agentPatterns ?? DEFAULT_AGENT_PATTERNS,
  );
  return new Map(commits.map((commit) => [commit.hash, commit]));
}

/** Hash-only walk of `rev` (HEAD by default), newest first. */
export async function commitPositions(
  git: GitGateway,
  rev = "HEAD",
): Promise<Map<string, number>> {
  const result = await git.run(["rev-list", rev], {
    allowExitCodes: [0, 128],
    timeoutMs: GIT_HEAVY_TIMEOUT_MS,
  });
  const positions = new Map<string, number>();
  if (result.exitCode === 128) {
    return positions;
  }

  result.stdout
    .toString("utf8")
    .split("\n")
    .forEach((hash, index) => {
      if (hash) {
        positions.set(hash, index);
      }
    });
  return positions;
}

export async function readCommit(
  git: GitGateway,
  rev: string,
  options: {
    readonly now?: Date;
    readonly agentPatterns?: readonly CompiledAgentPattern[];
  } = {},
): Promise<CommitSummary> {
  await assertCommitsExist(git, [rev]);

  const output = await git.text(
    ["log", "-1", `--format=${COMMIT_FORMAT}`, rev, "--"],
    { timeoutMs: GIT_HEAVY_TIMEOUT_MS },
  );
  const commit = parseCommitLog(
    output,
    options.now ?? new Date(),
    options.agentPatterns ?? DEFAULT_AGENT_PATTERNS,
  )[0];

  if (!commit) {
    throw new UnknownCommitError(rev);
  }

  return commit;
}

export async function firstParent(
  git: GitGateway,
  rev: string,
): Promise<string | null> {
  const result = await git.run(["rev-list", "--parents", "-n", "1", rev], {
    allowExitCodes: [0, 128],
  });
  if (result.exitCode === 128) {
    throw new UnknownCommitError(rev);
  }

  const fields = result.stdout.toString("utf8").trim().split(/\s+/);
  return fields[1] ?? null;
}
