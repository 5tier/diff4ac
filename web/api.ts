import type {
  BranchList,
  ChangeFile,
  ChangeSet,
  ChangeViewMode,
  CommitList,
  ConfigInfo,
  FilterRequest,
  Selection,
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

function appendFilters(
  params: URLSearchParams,
  filters: FilterRequest | undefined,
): URLSearchParams {
  if (!filters) {
    return params;
  }
  for (const extension of filters.disabledExtensions) {
    params.append("ext", extension);
  }
  for (const pattern of filters.includeGlobs) {
    params.append("include", pattern);
  }
  for (const pattern of filters.excludeGlobs) {
    params.append("exclude", pattern);
  }
  params.set("noise", filters.hideNoise ? "1" : "0");
  if (filters.fullContext) {
    params.set("context", "full");
  }
  return params;
}

function appendSelection(
  params: URLSearchParams,
  selection: Selection,
): URLSearchParams {
  switch (selection.kind) {
    case "pending":
      params.set("selection", "pending");
      break;
    case "commit":
      params.set("selection", "commit");
      params.set("hash", selection.commit.hash);
      break;
    case "commits":
      params.set("selection", "commits");
      params.set("hashes", selection.commits.map((commit) => commit.hash).join(","));
      params.set("mode", selection.mode);
      break;
    case "time-window":
      params.set("selection", "time-window");
      params.set("start", selection.window.start);
      params.set("end", selection.window.end);
      params.set("preset", selection.window.preset);
      params.set("mode", selection.mode);
      break;
    case "branch":
      params.set("selection", "branch");
      params.set("name", selection.branch.name);
      break;
  }
  return params;
}

export interface FileRequestContext {
  readonly selection: Selection;
  readonly worktreePath?: string | null;
  readonly agent?: string | null;
  readonly filters?: FilterRequest;
}

function fileRequestQuery(
  target: FileRequestContext,
  path: string,
  rev?: string,
): URLSearchParams {
  const params = appendSelection(
    new URLSearchParams(),
    target.selection,
  );
  if (target.worktreePath) {
    params.set("worktree", target.worktreePath);
  }
  if (target.agent) {
    params.set("agent", target.agent);
  }
  appendFilters(params, target.filters);
  params.set("path", path);
  if (rev !== undefined) {
    params.set("rev", rev);
  }
  return params;
}

export function fileContentUrl(
  target: FileRequestContext,
  path: string,
  rev: string,
): string {
  const params = fileRequestQuery(target, path, rev);
  params.set("token", sessionToken);
  return `/api/file-content?${params.toString()}`;
}

export interface FileDiffOptions {
  readonly signal?: AbortSignal;
  /** Ask for the whole file (`context=full`) instead of changed hunks only. */
  readonly fullContext?: boolean;
}

export function fetchFileDiff(
  target: FileRequestContext,
  path: string,
  rev: string | undefined,
  options: FileDiffOptions = {},
): Promise<ChangeFile> {
  const params = fileRequestQuery(target, path, rev);
  if (options.fullContext) {
    params.set("context", "full");
  }
  return getJson<ChangeFile>(
    `/api/file-diff?${params.toString()}`,
    options.signal,
  );
}

export function fetchPending(
  signal?: AbortSignal,
  filters?: FilterRequest,
): Promise<ChangeSet> {
  const query = appendFilters(new URLSearchParams(), filters).toString();
  return getJson<ChangeSet>(
    `/api/pending${query ? `?${query}` : ""}`,
    signal,
  );
}

export function fetchWorktreePending(
  path: string,
  signal?: AbortSignal,
  filters?: FilterRequest,
): Promise<ChangeSet> {
  const query = new URLSearchParams({ worktree: path });
  appendFilters(query, filters);
  return getJson<ChangeSet>(`/api/pending?${query.toString()}`, signal);
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
  filters?: FilterRequest,
): Promise<ChangeSet> {
  const query = new URLSearchParams({ hash });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  appendFilters(query, filters);
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
  filters?: FilterRequest,
): Promise<ChangeSet> {
  const query = new URLSearchParams({ name });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  appendFilters(query, filters);
  return getJson<ChangeSet>(`/api/branch?${query.toString()}`, signal);
}

export function fetchCommitSet(
  hashes: readonly string[],
  mode: ChangeViewMode,
  signal?: AbortSignal,
  worktreePath?: string | null,
  filters?: FilterRequest,
): Promise<ChangeSet> {
  const query = new URLSearchParams({
    hashes: hashes.join(","),
    mode,
  });
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  appendFilters(query, filters);
  return getJson<ChangeSet>(`/api/commit-set?${query.toString()}`, signal);
}

export function fetchTimeWindow(
  window: TimeWindow,
  mode: ChangeViewMode,
  signal?: AbortSignal,
  worktreePath?: string | null,
  agent?: string | null,
  filters?: FilterRequest,
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
  appendFilters(query, filters);
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
