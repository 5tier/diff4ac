import type {
  AgentPatternConfig,
  BaseBranch,
  BranchList,
  BranchSummary,
  ChangeFile,
  ChangeSet,
  ChangeTotals,
  CommitAuthor,
  CommitChangeGroup,
  CommitList,
  CommitSummary,
  ConfigDiagnostic,
  ConfigInfo,
  FilterInfo,
  Hunk,
  HunkLine,
  Selection,
  SessionInfo,
  SnapshotEntryKind,
  SnapshotChangeStatus,
  SnapshotFile,
  SnapshotPathMatch,
  SnapshotTreeEntry,
  TimeWindow,
  WorktreeInfo,
  WorktreeList,
  WorktreeSummary,
} from "./types";

export type GuardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly path: string; readonly expected: string };

export type Guard<T> = (value: unknown, path: string) => GuardResult<T>;

function succeed<T>(value: T): GuardResult<T> {
  return { ok: true, value };
}

function fail<T>(path: string, expected: string): GuardResult<T> {
  return { ok: false, path, expected };
}

function fieldPath(path: string, field: string): string {
  return path ? `${path}.${field}` : field;
}

function indexPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArrayOf<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
): value is readonly T[] {
  return Array.isArray(value) && value.every(predicate);
}

export function isOptional<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
): value is T | undefined {
  return value === undefined || predicate(value);
}

export function isNullable<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
): value is T | null {
  return value === null || predicate(value);
}

export function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return isString(value) && values.includes(value);
}

export function guardString(value: unknown, path: string): GuardResult<string> {
  return isString(value) ? succeed(value) : fail(path, "a string");
}

export function guardNumber(value: unknown, path: string): GuardResult<number> {
  return isNumber(value) ? succeed(value) : fail(path, "a number");
}

export function guardBoolean(
  value: unknown,
  path: string,
): GuardResult<boolean> {
  return isBoolean(value) ? succeed(value) : fail(path, "a boolean");
}

export function guardObject(
  value: unknown,
  path: string,
): GuardResult<Record<string, unknown>> {
  return isRecord(value) ? succeed(value) : fail(path, "an object");
}

export function guardArray<T>(
  guard: Guard<T>,
  value: unknown,
  path: string,
): GuardResult<readonly T[]> {
  if (!Array.isArray(value)) {
    return fail(path, "an array");
  }

  const items: T[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = guard(value[index], indexPath(path, index));
    if (!item.ok) {
      return item;
    }
    items.push(item.value);
  }
  return succeed(items);
}

export function guardOptional<T>(
  guard: Guard<T>,
  value: unknown,
  path: string,
): GuardResult<T | undefined> {
  return value === undefined ? succeed(undefined) : guard(value, path);
}

export function guardNullable<T>(
  guard: Guard<T>,
  value: unknown,
  path: string,
): GuardResult<T | null> {
  return value === null ? succeed(null) : guard(value, path);
}

export function guardOneOf<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
  path: string,
): GuardResult<Values[number]> {
  return isOneOf(value, values)
    ? succeed(value)
    : fail(path, `one of ${values.join(", ")}`);
}

function guardStringArray(
  value: unknown,
  path: string,
): GuardResult<readonly string[]> {
  return guardArray(guardString, value, path);
}

function object<T>(
  value: unknown,
  path: string,
  build: (
    record: Record<string, unknown>,
    at: (field: string) => string,
  ) => GuardResult<T>,
): GuardResult<T> {
  const record = guardObject(value, path);
  return record.ok
    ? build(record.value, (field) => fieldPath(path, field))
    : record;
}

const FILE_STATUSES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechanged",
  "unmerged",
  "untracked",
] as const;

const HUNK_LINE_TYPES = ["context", "add", "delete"] as const;

const VIEW_MODES = ["net", "stack"] as const;

const TIME_WINDOW_PRESETS = [
  "today",
  "yesterday",
  "last-24h",
  "custom",
] as const;

const THEMES = ["system", "light", "dark"] as const;

const SNAPSHOT_KINDS = ["dir", "file", "symlink", "submodule"] as const;

const SNAPSHOT_STATUSES = [
  "added",
  "modified",
  "deleted",
  "renamed",
] as const;

export const guardWorktreeInfo: Guard<WorktreeInfo> = (value, path) =>
  object(value, path, (record, at) => {
    const worktreePath = guardString(record.path, at("path"));
    if (!worktreePath.ok) {
      return worktreePath;
    }
    const branch = guardString(record.branch, at("branch"));
    if (!branch.ok) {
      return branch;
    }
    return succeed({ path: worktreePath.value, branch: branch.value });
  });

export const guardWorktreeSummary: Guard<WorktreeSummary> = (value, path) =>
  object(value, path, (record, at) => {
    const worktreePath = guardString(record.path, at("path"));
    if (!worktreePath.ok) {
      return worktreePath;
    }
    const branch = guardNullable(guardString, record.branch, at("branch"));
    if (!branch.ok) {
      return branch;
    }
    const head = guardString(record.head, at("head"));
    if (!head.ok) {
      return head;
    }
    const shortHead = guardString(record.shortHead, at("shortHead"));
    if (!shortHead.ok) {
      return shortHead;
    }
    const pendingCount = guardNumber(record.pendingCount, at("pendingCount"));
    if (!pendingCount.ok) {
      return pendingCount;
    }
    const current = guardBoolean(record.current, at("current"));
    if (!current.ok) {
      return current;
    }
    return succeed({
      path: worktreePath.value,
      branch: branch.value,
      head: head.value,
      shortHead: shortHead.value,
      pendingCount: pendingCount.value,
      current: current.value,
    });
  });

export const guardWorktreeList: Guard<WorktreeList> = (value, path) =>
  object(value, path, (record, at) => {
    const worktrees = guardArray(
      guardWorktreeSummary,
      record.worktrees,
      at("worktrees"),
    );
    return worktrees.ok ? succeed({ worktrees: worktrees.value }) : worktrees;
  });

export const guardHunkLine: Guard<HunkLine> = (value, path) =>
  object(value, path, (record, at) => {
    const type = guardOneOf(HUNK_LINE_TYPES, record.type, at("type"));
    if (!type.ok) {
      return type;
    }
    const content = guardString(record.content, at("content"));
    if (!content.ok) {
      return content;
    }
    const oldLine = guardNullable(guardNumber, record.oldLine, at("oldLine"));
    if (!oldLine.ok) {
      return oldLine;
    }
    const newLine = guardNullable(guardNumber, record.newLine, at("newLine"));
    if (!newLine.ok) {
      return newLine;
    }
    return succeed({
      type: type.value,
      content: content.value,
      oldLine: oldLine.value,
      newLine: newLine.value,
    });
  });

export const guardHunk: Guard<Hunk> = (value, path) =>
  object(value, path, (record, at) => {
    const header = guardString(record.header, at("header"));
    if (!header.ok) {
      return header;
    }
    const oldStart = guardNumber(record.oldStart, at("oldStart"));
    if (!oldStart.ok) {
      return oldStart;
    }
    const oldLines = guardNumber(record.oldLines, at("oldLines"));
    if (!oldLines.ok) {
      return oldLines;
    }
    const newStart = guardNumber(record.newStart, at("newStart"));
    if (!newStart.ok) {
      return newStart;
    }
    const newLines = guardNumber(record.newLines, at("newLines"));
    if (!newLines.ok) {
      return newLines;
    }
    const lines = guardArray(guardHunkLine, record.lines, at("lines"));
    if (!lines.ok) {
      return lines;
    }
    return succeed({
      header: header.value,
      oldStart: oldStart.value,
      oldLines: oldLines.value,
      newStart: newStart.value,
      newLines: newLines.value,
      lines: lines.value,
    });
  });

export const guardChangeFile: Guard<ChangeFile> = (value, path) =>
  object(value, path, (record, at) => {
    const filePath = guardString(record.path, at("path"));
    if (!filePath.ok) {
      return filePath;
    }
    const oldPath = guardOptional(guardString, record.oldPath, at("oldPath"));
    if (!oldPath.ok) {
      return oldPath;
    }
    const status = guardOneOf(FILE_STATUSES, record.status, at("status"));
    if (!status.ok) {
      return status;
    }
    const additions = guardNumber(record.additions, at("additions"));
    if (!additions.ok) {
      return additions;
    }
    const deletions = guardNumber(record.deletions, at("deletions"));
    if (!deletions.ok) {
      return deletions;
    }
    const binary = guardBoolean(record.binary, at("binary"));
    if (!binary.ok) {
      return binary;
    }
    const image = guardOptional(guardBoolean, record.image, at("image"));
    if (!image.ok) {
      return image;
    }
    const diff = guardString(record.diff, at("diff"));
    if (!diff.ok) {
      return diff;
    }
    const hunks = guardArray(guardHunk, record.hunks, at("hunks"));
    if (!hunks.ok) {
      return hunks;
    }
    const contentHash = guardString(record.contentHash, at("contentHash"));
    if (!contentHash.ok) {
      return contentHash;
    }
    const oldSize = guardOptional(guardNumber, record.oldSize, at("oldSize"));
    if (!oldSize.ok) {
      return oldSize;
    }
    const newSize = guardOptional(guardNumber, record.newSize, at("newSize"));
    if (!newSize.ok) {
      return newSize;
    }
    const oldMode = guardOptional(guardString, record.oldMode, at("oldMode"));
    if (!oldMode.ok) {
      return oldMode;
    }
    const newMode = guardOptional(guardString, record.newMode, at("newMode"));
    if (!newMode.ok) {
      return newMode;
    }
    const oldRev = guardOptional(guardString, record.oldRev, at("oldRev"));
    if (!oldRev.ok) {
      return oldRev;
    }
    const newRev = guardOptional(guardString, record.newRev, at("newRev"));
    if (!newRev.ok) {
      return newRev;
    }
    const collapsed = guardOptional(
      guardBoolean,
      record.collapsed,
      at("collapsed"),
    );
    if (!collapsed.ok) {
      return collapsed;
    }
    const reviewed = guardOptional(
      guardBoolean,
      record.reviewed,
      at("reviewed"),
    );
    if (!reviewed.ok) {
      return reviewed;
    }

    return succeed({
      path: filePath.value,
      ...(oldPath.value !== undefined ? { oldPath: oldPath.value } : {}),
      status: status.value,
      additions: additions.value,
      deletions: deletions.value,
      binary: binary.value,
      ...(image.value !== undefined ? { image: image.value } : {}),
      diff: diff.value,
      hunks: hunks.value,
      contentHash: contentHash.value,
      ...(oldSize.value !== undefined ? { oldSize: oldSize.value } : {}),
      ...(newSize.value !== undefined ? { newSize: newSize.value } : {}),
      ...(oldMode.value !== undefined ? { oldMode: oldMode.value } : {}),
      ...(newMode.value !== undefined ? { newMode: newMode.value } : {}),
      ...(oldRev.value !== undefined ? { oldRev: oldRev.value } : {}),
      ...(newRev.value !== undefined ? { newRev: newRev.value } : {}),
      ...(collapsed.value !== undefined
        ? { collapsed: collapsed.value }
        : {}),
      ...(reviewed.value !== undefined ? { reviewed: reviewed.value } : {}),
    });
  });

export const guardChangeTotals: Guard<ChangeTotals> = (value, path) =>
  object(value, path, (record, at) => {
    const files = guardNumber(record.files, at("files"));
    if (!files.ok) {
      return files;
    }
    const additions = guardNumber(record.additions, at("additions"));
    if (!additions.ok) {
      return additions;
    }
    const deletions = guardNumber(record.deletions, at("deletions"));
    if (!deletions.ok) {
      return deletions;
    }
    return succeed({
      files: files.value,
      additions: additions.value,
      deletions: deletions.value,
    });
  });

export const guardTimeWindow: Guard<TimeWindow> = (value, path) =>
  object(value, path, (record, at) => {
    const preset = guardOneOf(
      TIME_WINDOW_PRESETS,
      record.preset,
      at("preset"),
    );
    if (!preset.ok) {
      return preset;
    }
    const start = guardString(record.start, at("start"));
    if (!start.ok) {
      return start;
    }
    const end = guardString(record.end, at("end"));
    if (!end.ok) {
      return end;
    }
    const label = guardString(record.label, at("label"));
    if (!label.ok) {
      return label;
    }
    return succeed({
      preset: preset.value,
      start: start.value,
      end: end.value,
      label: label.value,
    });
  });

export const guardCommitAuthor: Guard<CommitAuthor> = (value, path) =>
  object(value, path, (record, at) => {
    const name = guardString(record.name, at("name"));
    if (!name.ok) {
      return name;
    }
    const email = guardString(record.email, at("email"));
    if (!email.ok) {
      return email;
    }
    return succeed({ name: name.value, email: email.value });
  });

export const guardCommitSummary: Guard<CommitSummary> = (value, path) =>
  object(value, path, (record, at) => {
    const hash = guardString(record.hash, at("hash"));
    if (!hash.ok) {
      return hash;
    }
    const shortHash = guardString(record.shortHash, at("shortHash"));
    if (!shortHash.ok) {
      return shortHash;
    }
    const message = guardString(record.message, at("message"));
    if (!message.ok) {
      return message;
    }
    const author = guardCommitAuthor(record.author, at("author"));
    if (!author.ok) {
      return author;
    }
    const committedAt = guardString(record.committedAt, at("committedAt"));
    if (!committedAt.ok) {
      return committedAt;
    }
    const relativeDate = guardString(record.relativeDate, at("relativeDate"));
    if (!relativeDate.ok) {
      return relativeDate;
    }
    const firstParent = guardNullable(
      guardString,
      record.firstParent,
      at("firstParent"),
    );
    if (!firstParent.ok) {
      return firstParent;
    }
    const agent = guardNullable(guardString, record.agent, at("agent"));
    if (!agent.ok) {
      return agent;
    }
    return succeed({
      hash: hash.value,
      shortHash: shortHash.value,
      message: message.value,
      author: author.value,
      committedAt: committedAt.value,
      relativeDate: relativeDate.value,
      firstParent: firstParent.value,
      agent: agent.value,
    });
  });

export const guardCommitList: Guard<CommitList> = (value, path) =>
  object(value, path, (record, at) => {
    const worktree = guardWorktreeInfo(record.worktree, at("worktree"));
    if (!worktree.ok) {
      return worktree;
    }
    const commits = guardArray(
      guardCommitSummary,
      record.commits,
      at("commits"),
    );
    if (!commits.ok) {
      return commits;
    }
    const hasMore = guardBoolean(record.hasMore, at("hasMore"));
    if (!hasMore.ok) {
      return hasMore;
    }
    return succeed({
      worktree: worktree.value,
      commits: commits.value,
      hasMore: hasMore.value,
    });
  });

export const guardBaseBranch: Guard<BaseBranch> = (value, path) =>
  object(value, path, (record, at) => {
    const name = guardString(record.name, at("name"));
    if (!name.ok) {
      return name;
    }
    const ref = guardString(record.ref, at("ref"));
    if (!ref.ok) {
      return ref;
    }
    return succeed({ name: name.value, ref: ref.value });
  });

export const guardBranchSummary: Guard<BranchSummary> = (value, path) =>
  object(value, path, (record, at) => {
    const name = guardString(record.name, at("name"));
    if (!name.ok) {
      return name;
    }
    const hash = guardString(record.hash, at("hash"));
    if (!hash.ok) {
      return hash;
    }
    const shortHash = guardString(record.shortHash, at("shortHash"));
    if (!shortHash.ok) {
      return shortHash;
    }
    const current = guardBoolean(record.current, at("current"));
    if (!current.ok) {
      return current;
    }
    return succeed({
      name: name.value,
      hash: hash.value,
      shortHash: shortHash.value,
      current: current.value,
    });
  });

export const guardBranchList: Guard<BranchList> = (value, path) =>
  object(value, path, (record, at) => {
    const worktree = guardWorktreeInfo(record.worktree, at("worktree"));
    if (!worktree.ok) {
      return worktree;
    }
    const baseBranch = guardNullable(
      guardBaseBranch,
      record.baseBranch,
      at("baseBranch"),
    );
    if (!baseBranch.ok) {
      return baseBranch;
    }
    const branches = guardArray(
      guardBranchSummary,
      record.branches,
      at("branches"),
    );
    if (!branches.ok) {
      return branches;
    }
    return succeed({
      worktree: worktree.value,
      baseBranch: baseBranch.value,
      branches: branches.value,
    });
  });

export const guardSelection: Guard<Selection> = (value, path) => {
  const record = guardObject(value, path);
  if (!record.ok) {
    return record;
  }

  const kind = guardString(record.value.kind, fieldPath(path, "kind"));
  if (!kind.ok) {
    return kind;
  }

  switch (kind.value) {
    case "pending":
      return succeed({ kind: "pending" });
    case "commit": {
      const commit = guardCommitSummary(
        record.value.commit,
        fieldPath(path, "commit"),
      );
      return commit.ok ? succeed({ kind: "commit", commit: commit.value }) : commit;
    }
    case "commits": {
      const commits = guardArray(
        guardCommitSummary,
        record.value.commits,
        fieldPath(path, "commits"),
      );
      if (!commits.ok) {
        return commits;
      }
      const mode = guardOneOf(
        VIEW_MODES,
        record.value.mode,
        fieldPath(path, "mode"),
      );
      if (!mode.ok) {
        return mode;
      }
      const contiguous = guardBoolean(
        record.value.contiguous,
        fieldPath(path, "contiguous"),
      );
      if (!contiguous.ok) {
        return contiguous;
      }
      return succeed({
        kind: "commits",
        commits: commits.value,
        mode: mode.value,
        contiguous: contiguous.value,
      });
    }
    case "time-window": {
      const window = guardTimeWindow(
        record.value.window,
        fieldPath(path, "window"),
      );
      if (!window.ok) {
        return window;
      }
      const commits = guardArray(
        guardCommitSummary,
        record.value.commits,
        fieldPath(path, "commits"),
      );
      if (!commits.ok) {
        return commits;
      }
      const mode = guardOneOf(
        VIEW_MODES,
        record.value.mode,
        fieldPath(path, "mode"),
      );
      if (!mode.ok) {
        return mode;
      }
      const contiguous = guardBoolean(
        record.value.contiguous,
        fieldPath(path, "contiguous"),
      );
      if (!contiguous.ok) {
        return contiguous;
      }
      return succeed({
        kind: "time-window",
        window: window.value,
        commits: commits.value,
        mode: mode.value,
        contiguous: contiguous.value,
      });
    }
    case "branch": {
      const branch = guardBranchSummary(
        record.value.branch,
        fieldPath(path, "branch"),
      );
      if (!branch.ok) {
        return branch;
      }
      const baseBranch = guardBaseBranch(
        record.value.baseBranch,
        fieldPath(path, "baseBranch"),
      );
      if (!baseBranch.ok) {
        return baseBranch;
      }
      return succeed({
        kind: "branch",
        branch: branch.value,
        baseBranch: baseBranch.value,
      });
    }
    default:
      return fail(
        fieldPath(path, "kind"),
        "one of pending, commit, commits, time-window, branch",
      );
  }
};

export const guardFilterInfo: Guard<FilterInfo> = (value, path) =>
  object(value, path, (record, at) => {
    const disabledExtensions = guardStringArray(
      record.disabledExtensions,
      at("disabledExtensions"),
    );
    if (!disabledExtensions.ok) {
      return disabledExtensions;
    }
    const includeGlobs = guardStringArray(record.includeGlobs, at("includeGlobs"));
    if (!includeGlobs.ok) {
      return includeGlobs;
    }
    const excludeGlobs = guardStringArray(record.excludeGlobs, at("excludeGlobs"));
    if (!excludeGlobs.ok) {
      return excludeGlobs;
    }
    const hideNoise = guardBoolean(record.hideNoise, at("hideNoise"));
    if (!hideNoise.ok) {
      return hideNoise;
    }
    const availableExtensions = guardStringArray(
      record.availableExtensions,
      at("availableExtensions"),
    );
    if (!availableExtensions.ok) {
      return availableExtensions;
    }
    const hiddenFiles = guardNumber(record.hiddenFiles, at("hiddenFiles"));
    if (!hiddenFiles.ok) {
      return hiddenFiles;
    }
    const fullContext = guardOptional(
      guardBoolean,
      record.fullContext,
      at("fullContext"),
    );
    if (!fullContext.ok) {
      return fullContext;
    }
    return succeed({
      disabledExtensions: disabledExtensions.value,
      includeGlobs: includeGlobs.value,
      excludeGlobs: excludeGlobs.value,
      hideNoise: hideNoise.value,
      availableExtensions: availableExtensions.value,
      hiddenFiles: hiddenFiles.value,
      ...(fullContext.value !== undefined
        ? { fullContext: fullContext.value }
        : {}),
    });
  });

export const guardCommitChangeGroup: Guard<CommitChangeGroup> = (value, path) =>
  object(value, path, (record, at) => {
    const commit = guardCommitSummary(record.commit, at("commit"));
    if (!commit.ok) {
      return commit;
    }
    const files = guardArray(guardChangeFile, record.files, at("files"));
    if (!files.ok) {
      return files;
    }
    const totals = guardChangeTotals(record.totals, at("totals"));
    if (!totals.ok) {
      return totals;
    }
    return succeed({
      commit: commit.value,
      files: files.value,
      totals: totals.value,
    });
  });

export const guardChangeSet: Guard<ChangeSet> = (value, path) =>
  object(value, path, (record, at) => {
    const selection = guardSelection(record.selection, at("selection"));
    if (!selection.ok) {
      return selection;
    }
    const worktree = guardWorktreeInfo(record.worktree, at("worktree"));
    if (!worktree.ok) {
      return worktree;
    }
    const files = guardArray(guardChangeFile, record.files, at("files"));
    if (!files.ok) {
      return files;
    }
    const totals = guardChangeTotals(record.totals, at("totals"));
    if (!totals.ok) {
      return totals;
    }
    const commitGroups = guardOptional(
      (item, groupPath) => guardArray(guardCommitChangeGroup, item, groupPath),
      record.commitGroups,
      at("commitGroups"),
    );
    if (!commitGroups.ok) {
      return commitGroups;
    }
    const filter = guardOptional(
      guardFilterInfo,
      record.filter,
      at("filter"),
    );
    if (!filter.ok) {
      return filter;
    }
    return succeed({
      selection: selection.value,
      worktree: worktree.value,
      files: files.value,
      totals: totals.value,
      ...(commitGroups.value !== undefined
        ? { commitGroups: commitGroups.value }
        : {}),
      ...(filter.value !== undefined ? { filter: filter.value } : {}),
    });
  });

function guardStringRecord(
  value: unknown,
  path: string,
): GuardResult<Readonly<Record<string, string>>> {
  const record = guardObject(value, path);
  if (!record.ok) {
    return record;
  }
  for (const [key, item] of Object.entries(record.value)) {
    if (!isString(item)) {
      return fail(fieldPath(path, key), "a string");
    }
  }
  return succeed(record.value as Record<string, string>);
}

export const guardConfigDiagnostic: Guard<ConfigDiagnostic> = (value, path) =>
  object(value, path, (record, at) => {
    const file = guardString(record.file, at("file"));
    if (!file.ok) {
      return file;
    }
    const field = guardString(record.field, at("field"));
    if (!field.ok) {
      return field;
    }
    const message = guardString(record.message, at("message"));
    if (!message.ok) {
      return message;
    }
    return succeed({
      file: file.value,
      field: field.value,
      message: message.value,
    });
  });

export const guardAgentPatternConfig: Guard<AgentPatternConfig> = (
  value,
  path,
) =>
  object(value, path, (record, at) => {
    const name = guardString(record.name, at("name"));
    if (!name.ok) {
      return name;
    }
    const trailers = guardStringArray(record.trailers, at("trailers"));
    if (!trailers.ok) {
      return trailers;
    }
    const authors = guardStringArray(record.authors, at("authors"));
    if (!authors.ok) {
      return authors;
    }
    return succeed({
      name: name.value,
      trailers: trailers.value,
      authors: authors.value,
    });
  });

export const guardConfigInfo: Guard<ConfigInfo> = (value, path) =>
  object(value, path, (record, at) => {
    const baseBranch = guardNullable(
      guardString,
      record.baseBranch,
      at("baseBranch"),
    );
    if (!baseBranch.ok) {
      return baseBranch;
    }
    const baseBranchFile = guardOptional(
      guardString,
      record.baseBranchFile,
      at("baseBranchFile"),
    );
    if (!baseBranchFile.ok) {
      return baseBranchFile;
    }
    const keybindings = guardStringRecord(record.keybindings, at("keybindings"));
    if (!keybindings.ok) {
      return keybindings;
    }
    const agents = guardArray(
      guardAgentPatternConfig,
      record.agents,
      at("agents"),
    );
    if (!agents.ok) {
      return agents;
    }
    const noise = guardStringArray(record.noise, at("noise"));
    if (!noise.ok) {
      return noise;
    }
    const theme = guardOneOf(THEMES, record.theme, at("theme"));
    if (!theme.ok) {
      return theme;
    }
    const diagnostics = guardArray(
      guardConfigDiagnostic,
      record.diagnostics,
      at("diagnostics"),
    );
    if (!diagnostics.ok) {
      return diagnostics;
    }
    return succeed({
      baseBranch: baseBranch.value,
      ...(baseBranchFile.value !== undefined
        ? { baseBranchFile: baseBranchFile.value }
        : {}),
      keybindings: keybindings.value,
      agents: agents.value,
      noise: noise.value,
      theme: theme.value,
      diagnostics: diagnostics.value,
    });
  });

export const guardSnapshotTreeEntry: Guard<SnapshotTreeEntry> = (
  value,
  path,
) =>
  object(value, path, (record, at) => {
    const name = guardString(record.name, at("name"));
    if (!name.ok) {
      return name;
    }
    const entryPath = guardString(record.path, at("path"));
    if (!entryPath.ok) {
      return entryPath;
    }
    const kind = guardOneOf(SNAPSHOT_KINDS, record.kind, at("kind"));
    if (!kind.ok) {
      return kind;
    }
    const status = guardOptional(
      (item, statusPath) =>
        guardOneOf(SNAPSHOT_STATUSES, item, statusPath),
      record.status,
      at("status"),
    );
    if (!status.ok) {
      return status;
    }
    const oldPath = guardOptional(guardString, record.oldPath, at("oldPath"));
    if (!oldPath.ok) {
      return oldPath;
    }
    const renamedTo = guardOptional(
      guardString,
      record.renamedTo,
      at("renamedTo"),
    );
    if (!renamedTo.ok) {
      return renamedTo;
    }
    const containsChanges = guardOptional(
      guardBoolean,
      record.containsChanges,
      at("containsChanges"),
    );
    if (!containsChanges.ok) {
      return containsChanges;
    }
    const noise = guardOptional(guardBoolean, record.noise, at("noise"));
    if (!noise.ok) {
      return noise;
    }
    return succeed({
      name: name.value,
      path: entryPath.value,
      kind: kind.value as SnapshotEntryKind,
      ...(status.value !== undefined ? { status: status.value } : {}),
      ...(oldPath.value !== undefined ? { oldPath: oldPath.value } : {}),
      ...(renamedTo.value !== undefined
        ? { renamedTo: renamedTo.value }
        : {}),
      ...(containsChanges.value !== undefined
        ? { containsChanges: containsChanges.value }
        : {}),
      ...(noise.value !== undefined ? { noise: noise.value } : {}),
    });
  });

export const guardSnapshotTree: Guard<readonly SnapshotTreeEntry[]> = (
  value,
  path,
) => guardArray(guardSnapshotTreeEntry, value, path);

export const guardSnapshotFile: Guard<SnapshotFile> = (value, path) =>
  object(value, path, (record, at) => {
    const filePath = guardString(record.path, at("path"));
    if (!filePath.ok) {
      return filePath;
    }
    const kind = guardOneOf(SNAPSHOT_KINDS, record.kind, at("kind"));
    if (!kind.ok) {
      return kind;
    }
    const size = guardNumber(record.size, at("size"));
    if (!size.ok) {
      return size;
    }
    const binary = guardBoolean(record.binary, at("binary"));
    if (!binary.ok) {
      return binary;
    }
    const image = guardBoolean(record.image, at("image"));
    if (!image.ok) {
      return image;
    }
    const text = guardOptional(guardString, record.text, at("text"));
    if (!text.ok) {
      return text;
    }
    const truncated = guardOptional(
      guardBoolean,
      record.truncated,
      at("truncated"),
    );
    if (!truncated.ok) {
      return truncated;
    }
    const totalLines = guardOptional(
      guardNumber,
      record.totalLines,
      at("totalLines"),
    );
    if (!totalLines.ok) {
      return totalLines;
    }
    const status = guardOptional(
      (item, statusPath) =>
        guardOneOf(SNAPSHOT_STATUSES, item, statusPath),
      record.status,
      at("status"),
    );
    if (!status.ok) {
      return status;
    }
    const deleted = guardOptional(
      guardBoolean,
      record.deleted,
      at("deleted"),
    );
    if (!deleted.ok) {
      return deleted;
    }
    const submoduleOid = guardOptional(
      guardString,
      record.submoduleOid,
      at("submoduleOid"),
    );
    if (!submoduleOid.ok) {
      return submoduleOid;
    }
    return succeed({
      path: filePath.value,
      kind: kind.value as SnapshotEntryKind,
      size: size.value,
      binary: binary.value,
      image: image.value,
      ...(text.value !== undefined ? { text: text.value } : {}),
      ...(truncated.value !== undefined
        ? { truncated: truncated.value }
        : {}),
      ...(totalLines.value !== undefined
        ? { totalLines: totalLines.value }
        : {}),
      ...(status.value !== undefined ? { status: status.value } : {}),
      ...(deleted.value !== undefined ? { deleted: deleted.value } : {}),
      ...(submoduleOid.value !== undefined
        ? { submoduleOid: submoduleOid.value }
        : {}),
    });
  });

export const guardSnapshotPathMatches: Guard<readonly SnapshotPathMatch[]> = (
  value,
  path,
) =>
  guardArray(
    (item, itemPath) =>
      object(item, itemPath, (record, at) => {
        const matchPath = guardString(record.path, at("path"));
        if (!matchPath.ok) {
          return matchPath;
        }
        const status = guardOptional(
          (statusValue, statusPath) =>
            guardOneOf(SNAPSHOT_STATUSES, statusValue, statusPath),
          record.status,
          at("status"),
        );
        if (!status.ok) {
          return status;
        }
        return succeed({
          path: matchPath.value,
          ...(status.value !== undefined ? { status: status.value } : {}),
        });
      }),
    value,
    path,
  );

export const guardSessionInfo: Guard<SessionInfo> = (value, path) =>
  object(value, path, (record, at) => {
    const worktree = guardWorktreeInfo(record.worktree, at("worktree"));
    if (!worktree.ok) {
      return worktree;
    }
    const version = guardString(record.version, at("version"));
    if (!version.ok) {
      return version;
    }
    return succeed({ worktree: worktree.value, version: version.value });
  });

export interface ReviewMarkResponse {
  readonly path: string;
  readonly contentHash: string;
  readonly reviewed: boolean;
}

export const guardReviewMarkResponse: Guard<ReviewMarkResponse> = (
  value,
  path,
) =>
  object(value, path, (record, at) => {
    const filePath = guardString(record.path, at("path"));
    if (!filePath.ok) {
      return filePath;
    }
    const contentHash = guardString(record.contentHash, at("contentHash"));
    if (!contentHash.ok) {
      return contentHash;
    }
    const reviewed = guardBoolean(record.reviewed, at("reviewed"));
    if (!reviewed.ok) {
      return reviewed;
    }
    return succeed({
      path: filePath.value,
      contentHash: contentHash.value,
      reviewed: reviewed.value,
    });
  });

export interface ReviewMarkRequest {
  readonly path: string;
  readonly contentHash: string;
  readonly reviewed: boolean;
}

export const guardReviewMarkRequest: Guard<ReviewMarkRequest> = (
  value,
  path,
) => guardReviewMarkResponse(value, path);
