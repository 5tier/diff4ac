import type {
  ChangeFile,
  ChangeSet,
  ChangeViewMode,
  CommitChangeGroup,
  CommitSummary,
  FilterRequest,
  Selection,
  TimeWindow,
} from "../../shared/types";
import {
  isContiguousCommitSelection,
  modeLabel,
} from "../../shared/changeset/selection";
import { filterCommitsInTimeWindow } from "../../shared/time-windows";
import { ApiError } from "../api-error";

export function selectionLabel(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "Pending";
    case "commit":
      return `Commit ${selection.commit.shortHash} · ${selection.commit.message}`;
    case "commits":
      return `${selection.commits.length} commits · ${modeLabel(selection.mode)}`;
    case "time-window":
      return `Time Window · ${selection.window.label}`;
    case "branch":
      return `Branch ${selection.branch.name} since ${selection.baseBranch.name}`;
  }
}

export function selectionBadge(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "Pending";
    case "commit":
      return `Commit ${selection.commit.shortHash}`;
    case "commits":
      return `Commits ${selection.commits.length}`;
    case "time-window":
      return "Time Window";
    case "branch":
      return `Branch ${selection.branch.name}`;
  }
}

export function modeStatusLabel(selection: Selection): string | null {
  if (selection.kind !== "commits" && selection.kind !== "time-window") {
    return null;
  }
  return selection.contiguous
    ? modeLabel(selection.mode)
    : `${modeLabel(selection.mode)} (non-contiguous)`;
}

export function emptyFilesMessage(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "No Pending changes in this Worktree.";
    case "commit":
      return "This commit has no file changes.";
    case "commits":
      return "These commits have no file changes.";
    case "time-window":
      return selection.commits.length === 0
        ? "No commits landed in this Time Window."
        : "This Time Window has no file changes.";
    case "branch":
      return selection.branch.name === selection.baseBranch.name
        ? "No changes: this is the Base Branch."
        : "No changes since the Base Branch.";
  }
}

export function selectionIncludesCommit(
  selection: Selection,
  hash: string,
): boolean {
  if (selection.kind === "commit") {
    return selection.commit.hash === hash;
  }
  if (selection.kind === "commits" || selection.kind === "time-window") {
    return selection.commits.some((commit) => commit.hash === hash);
  }
  return false;
}

export function selectionFromPicks(
  allCommits: readonly CommitSummary[],
  hashes: readonly string[],
  mode: ChangeViewMode,
): Selection {
  const commits = allCommits.filter((commit) => hashes.includes(commit.hash));
  if (commits.length === 0) {
    return { kind: "pending" };
  }
  if (commits.length === 1) {
    return { kind: "commit", commit: commits[0] as CommitSummary };
  }

  const contiguous = isContiguousCommitSelection(commits);
  return {
    kind: "commits",
    commits,
    mode: contiguous ? mode : "stack",
    contiguous,
  };
}

export function splitGlobLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function activeFilterSummary(filter: FilterRequest | undefined): string {
  if (!filter) {
    return "none";
  }

  const parts: string[] = [];
  if (filter.hideNoise) {
    parts.push("noise on");
  }
  if (filter.disabledExtensions.length > 0) {
    parts.push(
      `${filter.disabledExtensions
        .map((extension) => extension || "(no extension)")
        .join(", ")} off`,
    );
  }
  if (filter.includeGlobs.length > 0) {
    parts.push(`include ${filter.includeGlobs.length}`);
  }
  if (filter.excludeGlobs.length > 0) {
    parts.push(`exclude ${filter.excludeGlobs.length}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "none";
}

export function hiddenFilesLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"} hidden`;
}

export function selectionFromTimeWindow(
  window: TimeWindow,
  allCommits: readonly CommitSummary[],
): Selection {
  const commits = filterCommitsInTimeWindow(allCommits, window);
  const contiguous = isContiguousCommitSelection(commits);
  return {
    kind: "time-window",
    window,
    commits,
    mode: contiguous ? "net" : "stack",
    contiguous,
  };
}

export function sameTimeWindowSelection(
  left: Extract<Selection, { kind: "time-window" }>,
  right: Extract<Selection, { kind: "time-window" }>,
): boolean {
  return (
    left.window.preset === right.window.preset &&
    left.window.start === right.window.start &&
    left.window.end === right.window.end &&
    left.mode === right.mode &&
    left.contiguous === right.contiguous &&
    left.commits.length === right.commits.length &&
    left.commits.every(
      (commit, index) => commit.hash === right.commits[index]?.hash,
    )
  );
}

export function isNotFoundError(reason: unknown): boolean {
  return reason instanceof ApiError && reason.status === 404;
}

export function missingSelectionLabel(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "This Worktree";
    case "commit":
      return `Commit ${selection.commit.shortHash}`;
    case "commits":
      return `${selection.commits.length} commits`;
    case "time-window":
      return `Time Window ${selection.window.label}`;
    case "branch":
      return `Branch ${selection.branch.name}`;
  }
}

export function setChangeFileReviewState(
  changeSet: ChangeSet,
  path: string,
  contentHash: string,
  reviewed: boolean,
): ChangeSet {
  const update = (file: ChangeFile): ChangeFile =>
    file.path === path && file.contentHash === contentHash
      ? { ...file, reviewed }
      : file;

  if (changeSet.commitGroups) {
    const commitGroups = changeSet.commitGroups.map((group) => ({
      ...group,
      files: group.files.map(update),
    }));

    return {
      ...changeSet,
      files: commitGroups.flatMap((group) => group.files),
      commitGroups,
    };
  }

  return { ...changeSet, files: changeSet.files.map(update) };
}

export function replaceChangeFile(
  changeSet: ChangeSet,
  path: string,
  rev: string | undefined,
  updated: ChangeFile,
): ChangeSet {
  const matches = (file: ChangeFile): boolean =>
    file.path === path &&
    (rev === undefined || file.oldRev === rev || file.newRev === rev);
  const replace = (file: ChangeFile): ChangeFile =>
    matches(file) ? updated : file;

  if (changeSet.commitGroups) {
    const commitGroups = changeSet.commitGroups.map((group) => ({
      ...group,
      files: group.files.map(replace),
    }));

    return {
      ...changeSet,
      files: commitGroups.flatMap((group) => group.files),
      commitGroups,
    };
  }

  return { ...changeSet, files: changeSet.files.map(replace) };
}

export function selectionCacheKey(selection: Selection | undefined): string {
  if (!selection) {
    return "";
  }
  switch (selection.kind) {
    case "pending":
      return "pending";
    case "commit":
      return `commit:${selection.commit.hash}`;
    case "commits":
      return `commits:${selection.mode}:${selection.commits
        .map((commit) => commit.hash)
        .join(",")}`;
    case "time-window":
      return `time-window:${selection.window.start}:${selection.window.end}:${selection.mode}`;
    case "branch":
      return `branch:${selection.branch.name}`;
  }
}

export function fullFileCacheKey(
  selectionKey: string,
  path: string,
  rev: string | undefined,
): string {
  return `${selectionKey}\u0000${path}\u0000${rev ?? ""}`;
}

export function stackFileId(commitHash: string, path: string): string {
  return `stack-${commitHash}-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function stackFileKey(commitHash: string, path: string): string {
  return `${commitHash}:${path}`;
}

export function stackFileIndices(
  groups: readonly CommitChangeGroup[],
): Map<string, number> {
  const indices = new Map<string, number>();
  let index = 0;
  for (const group of groups) {
    for (const file of group.files) {
      indices.set(`${group.commit.hash}:${file.path}`, index);
      index++;
    }
  }
  return indices;
}
