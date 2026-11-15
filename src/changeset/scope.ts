import type { CompiledAgentPattern } from "../agents";
import type { GitGateway } from "../git/gateway";
import type {
  ChangeFile,
  ChangeSet,
  ChangeViewMode,
  TimeWindow,
} from "../types";
import { buildBranchChangeSet, resolveBranchScope } from "./branch";
import { buildCommitChangeSet, resolveCommitRange } from "./commit";
import {
  buildCommitsChangeSet,
  buildTimeWindowChangeSet,
  resolveCommitGroupRanges,
  resolveSelectedCommits,
  resolveTimeWindowScope,
} from "./commits";
import {
  buildChangeFiles,
  listChangeRecords,
  selectChangeRecord,
  type ChangeFileOptions,
  type DiffRange,
  type FileStatusRecord,
} from "./files";
import { buildPendingChangeSet, resolvePendingScope } from "./pending";

export type ChangeSetScope =
  | { readonly kind: "pending" }
  | { readonly kind: "commit"; readonly hash: string }
  | {
      readonly kind: "commits";
      readonly hashes: readonly string[];
      readonly mode: ChangeViewMode;
    }
  | {
      readonly kind: "time-window";
      readonly window: TimeWindow;
      readonly mode: ChangeViewMode | "auto";
      readonly agent?: string;
    }
  | { readonly kind: "branch"; readonly name: string };

export interface ScopedChangeSetOptions extends ChangeFileOptions {
  readonly agentPatterns?: readonly CompiledAgentPattern[];
  readonly baseBranch?: string | null;
}

export async function buildScopedChangeSet(
  git: GitGateway,
  scope: ChangeSetScope,
  options: ScopedChangeSetOptions = {},
): Promise<ChangeSet> {
  switch (scope.kind) {
    case "pending":
      return buildPendingChangeSet(git, options);
    case "commit":
      return buildCommitChangeSet(git, scope.hash, options);
    case "commits":
      return buildCommitsChangeSet(
        git,
        scope.hashes,
        scope.mode,
        options,
      );
    case "time-window":
      return buildTimeWindowChangeSet(git, scope.window, scope.mode, {
        agentPatterns: options.agentPatterns,
        agent: scope.agent,
        ...options,
      });
    case "branch":
      return buildBranchChangeSet(
        git,
        scope.name,
        options.baseBranch ?? null,
        options,
      );
  }
}

async function fileFromRecords(
  git: GitGateway,
  range: DiffRange,
  records: readonly FileStatusRecord[],
  path: string,
  rev: string | null,
  pendingScope: boolean,
  options: ChangeFileOptions,
): Promise<ChangeFile | undefined> {
  const record = selectChangeRecord(range, records, path, rev, pendingScope);
  if (!record) {
    return undefined;
  }

  const files = await buildChangeFiles(git, range, [record], options);
  return files[0];
}

async function fileFromRange(
  git: GitGateway,
  range: DiffRange,
  path: string,
  rev: string | null,
  pendingScope: boolean,
  options: ChangeFileOptions,
): Promise<ChangeFile | undefined> {
  return fileFromRecords(
    git,
    range,
    await listChangeRecords(git, range),
    path,
    rev,
    pendingScope,
    options,
  );
}

async function fileFromRanges(
  git: GitGateway,
  ranges: readonly DiffRange[],
  path: string,
  rev: string | null,
  options: ChangeFileOptions,
): Promise<ChangeFile | undefined> {
  for (const range of ranges) {
    const file = await fileFromRange(git, range, path, rev, false, options);
    if (file) {
      return file;
    }
  }
  return undefined;
}

/**
 * Build one Change File without building the rest of its Change Set. Rename
 * detection and the name-status listing still cover the whole range; only the
 * per-file diff, hash and size work is restricted to the selected record.
 *
 * The result is byte-for-byte the entry `buildScopedChangeSet` would produce
 * for the same path and rev.
 */
export async function buildScopedChangeFile(
  git: GitGateway,
  scope: ChangeSetScope,
  path: string,
  rev: string | null = null,
  options: ScopedChangeSetOptions = {},
): Promise<ChangeFile | undefined> {
  switch (scope.kind) {
    case "pending": {
      const resolved = await resolvePendingScope(git);
      return fileFromRecords(
        git,
        resolved.range,
        resolved.records,
        path,
        rev,
        true,
        options,
      );
    }
    case "commit":
      return fileFromRange(
        git,
        await resolveCommitRange(git, scope.hash),
        path,
        rev,
        false,
        options,
      );
    case "commits": {
      const resolved = await resolveSelectedCommits(
        git,
        scope.hashes,
        scope.mode,
        options,
      );
      const ranges = await resolveCommitGroupRanges(
        git,
        resolved.selected,
        scope.mode,
      );
      return fileFromRanges(
        git,
        ranges.map((entry) => entry.range),
        path,
        rev,
        options,
      );
    }
    case "time-window": {
      const resolved = await resolveTimeWindowScope(
        git,
        scope.window,
        scope.mode,
        {
          agentPatterns: options.agentPatterns,
          agent: scope.agent,
        },
      );
      if (resolved.selected.length === 0) {
        return undefined;
      }
      const ranges = await resolveCommitGroupRanges(
        git,
        resolved.selected,
        resolved.mode,
      );
      return fileFromRanges(
        git,
        ranges.map((entry) => entry.range),
        path,
        rev,
        options,
      );
    }
    case "branch": {
      const resolved = await resolveBranchScope(
        git,
        scope.name,
        options.baseBranch ?? null,
      );
      return fileFromRange(
        git,
        resolved.range,
        path,
        rev,
        false,
        options,
      );
    }
  }
}
