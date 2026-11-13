import type {
  BranchList,
  ChangeSet,
  ChangeViewMode,
  CommitList,
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

export function fetchCommits(signal?: AbortSignal): Promise<CommitList> {
  return getJson<CommitList>("/api/commits", signal);
}

export function fetchCommit(
  hash: string,
  signal?: AbortSignal,
): Promise<ChangeSet> {
  return getJson<ChangeSet>(
    `/api/commit?hash=${encodeURIComponent(hash)}`,
    signal,
  );
}

export function fetchBranches(signal?: AbortSignal): Promise<BranchList> {
  return getJson<BranchList>("/api/branches", signal);
}

export function fetchBranch(
  name: string,
  signal?: AbortSignal,
): Promise<ChangeSet> {
  return getJson<ChangeSet>(
    `/api/branch?name=${encodeURIComponent(name)}`,
    signal,
  );
}

export function fetchCommitSet(
  hashes: readonly string[],
  mode: ChangeViewMode,
  signal?: AbortSignal,
): Promise<ChangeSet> {
  return getJson<ChangeSet>(
    `/api/commit-set?hashes=${encodeURIComponent(hashes.join(","))}&mode=${mode}`,
    signal,
  );
}
