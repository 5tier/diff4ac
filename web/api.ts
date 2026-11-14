import type {
  BranchList,
  ChangeSet,
  ChangeViewMode,
  CommitList,
  ConfigInfo,
  TimeWindow,
  WorktreeList,
} from "../src/types";

const TOKEN_KEY = "diff4ac-token";

function readToken(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");

  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl;
  }

  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export const sessionToken = readToken();

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { "x-diff4ac-token": sessionToken },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export function fetchConfig(signal?: AbortSignal): Promise<ConfigInfo> {
  return getJson<ConfigInfo>("/api/config", signal);
}

export function fetchPending(signal?: AbortSignal): Promise<ChangeSet> {
  return getJson<ChangeSet>("/api/pending", signal);
}

export function fetchWorktreePending(
  path: string,
  signal?: AbortSignal,
): Promise<ChangeSet> {
  return getJson<ChangeSet>(
    `/api/pending?worktree=${encodeURIComponent(path)}`,
    signal,
  );
}

export function fetchWorktrees(signal?: AbortSignal): Promise<WorktreeList> {
  return getJson<WorktreeList>("/api/worktrees", signal);
}

function worktreeQuery(worktreePath: string | null | undefined): string {
  return worktreePath
    ? `worktree=${encodeURIComponent(worktreePath)}`
    : "";
}

export function fetchCommits(
  signal?: AbortSignal,
  worktreePath?: string | null,
): Promise<CommitList> {
  const query = worktreeQuery(worktreePath);
  return getJson<CommitList>(
    `/api/commits${query ? `?${query}` : ""}`,
    signal,
  );
}

export function fetchCommit(
  hash: string,
  signal?: AbortSignal,
  worktreePath?: string | null,
): Promise<ChangeSet> {
  const query = new URLSearchParams({ hash });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  return getJson<ChangeSet>(`/api/commit?${query.toString()}`, signal);
}

export function fetchBranches(
  signal?: AbortSignal,
  worktreePath?: string | null,
): Promise<BranchList> {
  const query = worktreeQuery(worktreePath);
  return getJson<BranchList>(
    `/api/branches${query ? `?${query}` : ""}`,
    signal,
  );
}

export function fetchBranch(
  name: string,
  signal?: AbortSignal,
  worktreePath?: string | null,
): Promise<ChangeSet> {
  const query = new URLSearchParams({ name });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  return getJson<ChangeSet>(`/api/branch?${query.toString()}`, signal);
}

export function fetchCommitSet(
  hashes: readonly string[],
  mode: ChangeViewMode,
  signal?: AbortSignal,
  worktreePath?: string | null,
): Promise<ChangeSet> {
  const query = new URLSearchParams({
    hashes: hashes.join(","),
    mode,
  });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  return getJson<ChangeSet>(`/api/commit-set?${query.toString()}`, signal);
}

export function fetchTimeWindow(
  window: TimeWindow,
  mode: ChangeViewMode,
  signal?: AbortSignal,
  worktreePath?: string | null,
  agent?: string | null,
): Promise<ChangeSet> {
  const query = new URLSearchParams({
    start: window.start,
    end: window.end,
    preset: window.preset,
    mode,
  });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  if (agent) {
    query.set("agent", agent);
  }
  return getJson<ChangeSet>(`/api/time-window?${query.toString()}`, signal);
}

export interface ReviewMarkResponse {
  readonly path: string;
  readonly contentHash: string;
  readonly reviewed: boolean;
}

export async function setReviewMark(
  path: string,
  contentHash: string,
  reviewed: boolean,
  signal?: AbortSignal,
): Promise<ReviewMarkResponse> {
  const response = await fetch("/api/review-mark", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-diff4ac-token": sessionToken,
    },
    body: JSON.stringify({ path, contentHash, reviewed }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as ReviewMarkResponse;
}

export function subscribeRepositoryChanges(
  onChange: () => void,
): () => void {
  const source = new EventSource(
    `/api/events?token=${encodeURIComponent(sessionToken)}`,
  );
  source.addEventListener("repository-changed", onChange);
  return () => source.close();
}
