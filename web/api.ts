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
} from "../shared/types";
import {
  guardBranchList,
  guardChangeFile,
  guardChangeSet,
  guardCommitList,
  guardConfigInfo,
  guardReviewMarkResponse,
  guardWorktreeList,
  type Guard,
  type ReviewMarkResponse,
} from "../shared/api-contract";
import { ApiError } from "./api-error";

function contractFailure(
  path: string,
  failure: { readonly path: string; readonly expected: string },
): ApiError {
  return new ApiError(
    0,
    `${path}: ${failure.path || "response"} is not ${failure.expected}`,
    "contract",
  );
}

async function getJson<T>(
  path: string,
  guard: Guard<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(0, `${path}: response is not valid JSON`, "contract");
  }

  const parsed = guard(body, "");
  if (!parsed.ok) {
    throw contractFailure(path, parsed);
  }
  return parsed.value;
}

export function fetchConfig(signal?: AbortSignal): Promise<ConfigInfo> {
  return getJson("/api/config", guardConfigInfo, signal);
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
  return getJson(
    `/api/file-diff?${params.toString()}`,
    guardChangeFile,
    options.signal,
  );
}

export function fetchPending(
  signal?: AbortSignal,
  filters?: FilterRequest,
): Promise<ChangeSet> {
  const query = appendFilters(new URLSearchParams(), filters).toString();
  return getJson(
    `/api/pending${query ? `?${query}` : ""}`,
    guardChangeSet,
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
  return getJson(`/api/pending?${query.toString()}`, guardChangeSet, signal);
}

export function fetchWorktrees(signal?: AbortSignal): Promise<WorktreeList> {
  return getJson("/api/worktrees", guardWorktreeList, signal);
}

function worktreeQuery(worktreePath: string | null | undefined): string {
  return worktreePath
    ? `worktree=${encodeURIComponent(worktreePath)}`
    : "";
}

export function fetchCommits(
  signal?: AbortSignal,
  worktreePath?: string | null,
  skip = 0,
): Promise<CommitList> {
  const query = new URLSearchParams();
  if (worktreePath) {
    query.set("worktree", worktreePath);
  }
  if (skip > 0) {
    query.set("skip", String(skip));
  }
  const suffix = query.toString();
  return getJson(
    `/api/commits${suffix ? `?${suffix}` : ""}`,
    guardCommitList,
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
  return getJson(`/api/commit?${query.toString()}`, guardChangeSet, signal);
}

export function fetchBranches(
  signal?: AbortSignal,
  worktreePath?: string | null,
): Promise<BranchList> {
  const query = worktreeQuery(worktreePath);
  return getJson(
    `/api/branches${query ? `?${query}` : ""}`,
    guardBranchList,
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
  return getJson(`/api/branch?${query.toString()}`, guardChangeSet, signal);
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
  return getJson(`/api/commit-set?${query.toString()}`, guardChangeSet, signal);
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
  return getJson(`/api/time-window?${query.toString()}`, guardChangeSet, signal);
}

export async function setReviewMark(
  path: string,
  contentHash: string,
  reviewed: boolean,
  signal?: AbortSignal,
): Promise<ReviewMarkResponse> {
  const response = await fetch("/api/review-mark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ path, contentHash, reviewed }),
    signal,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      0,
      "/api/review-mark: response is not valid JSON",
      "contract",
    );
  }

  const parsed = guardReviewMarkResponse(body, "");
  if (!parsed.ok) {
    throw contractFailure("/api/review-mark", parsed);
  }
  return parsed.value;
}

export function subscribeRepositoryChanges(
  onChange: () => void,
): () => void {
  const source = new EventSource("/api/events");
  source.addEventListener("repository-changed", onChange);
  return () => source.close();
}
