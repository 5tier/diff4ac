import type { CompiledAgentPattern } from "../agents";
import {
  resolveBranchScope,
} from "../changeset/branch";
import { resolveCommitRange } from "../changeset/commit";
import {
  resolveCommitGroupRanges,
  resolveSelectedCommits,
  resolveTimeWindowScope,
} from "../changeset/commits";
import {
  emptyTreeRef,
  listChangeRecords,
  type DiffRange,
  type FileStatusRecord,
} from "../changeset/files";
import {
  resolvePendingScope,
} from "../changeset/pending";
import type { ChangeSetScope } from "../changeset/scope";
import type { GitGateway } from "../git/gateway";
import type {
  FileStatus,
  SnapshotChangeStatus,
} from "../../shared/types";

export type SnapshotRef =
  | { readonly kind: "commit"; readonly rev: string }
  | { readonly kind: "worktree"; readonly root: string };

export interface SnapshotChangeEntry {
  readonly status: SnapshotChangeStatus;
  readonly oldPath?: string;
  readonly renamedTo?: string;
}

export type SnapshotChangeMap = ReadonlyMap<string, SnapshotChangeEntry>;

export interface ResolvedSnapshotScopes {
  readonly after: SnapshotRef;
  readonly before: SnapshotRef;
  readonly afterIndex: SnapshotChangeMap;
  readonly beforeIndex: SnapshotChangeMap;
}

export interface SnapshotScopeOptions {
  readonly agentPatterns?: readonly CompiledAgentPattern[];
  readonly baseBranch?: string | null;
}

function snapshotStatus(status: FileStatus): SnapshotChangeStatus | null {
  switch (status) {
    case "added":
    case "untracked":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "modified":
    case "copied":
    case "typechanged":
    case "unmerged":
      return "modified";
  }
}

function buildIndexes(records: readonly FileStatusRecord[]): {
  readonly after: SnapshotChangeMap;
  readonly before: SnapshotChangeMap;
} {
  const after = new Map<string, SnapshotChangeEntry>();
  const before = new Map<string, SnapshotChangeEntry>();

  for (const record of records) {
    const status = snapshotStatus(record.status);
    if (!status) {
      continue;
    }

    if (status === "renamed" && record.oldPath) {
      after.set(record.path, {
        status: "renamed",
        oldPath: record.oldPath,
      });
      after.set(record.oldPath, {
        status: "deleted",
        renamedTo: record.path,
      });
      before.set(record.oldPath, {
        status: "renamed",
        renamedTo: record.path,
      });
      continue;
    }

    if (status === "added") {
      after.set(record.path, { status: "added" });
      continue;
    }

    after.set(record.path, { status });
    before.set(record.path, { status });
  }

  return { after, before };
}

async function recordsForRange(
  git: GitGateway,
  range: DiffRange,
): Promise<readonly FileStatusRecord[]> {
  return listChangeRecords(git, range);
}

export async function resolveSnapshotScopes(
  git: GitGateway,
  scope: ChangeSetScope,
  options: SnapshotScopeOptions = {},
): Promise<ResolvedSnapshotScopes> {
  const empty = { kind: "commit", rev: await emptyTreeRef(git) } as const;

  switch (scope.kind) {
    case "pending": {
      const resolved = await resolvePendingScope(git);
      const { after, before } = buildIndexes(resolved.records);
      return {
        after: { kind: "worktree", root: git.worktreeRoot },
        before: {
          kind: "commit",
          rev: resolved.range.baseRef,
        },
        afterIndex: after,
        beforeIndex: before,
      };
    }
    case "commit": {
      const range = await resolveCommitRange(git, scope.hash);
      const records = await recordsForRange(git, range);
      const { after, before } = buildIndexes(records);
      return {
        after: { kind: "commit", rev: range.targetRef ?? scope.hash },
        before: { kind: "commit", rev: range.baseRef },
        afterIndex: after,
        beforeIndex: before,
      };
    }
    case "commits": {
      const resolved = await resolveSelectedCommits(
        git,
        scope.hashes,
        scope.mode,
        { agentPatterns: options.agentPatterns },
      );
      const net = await resolveCommitGroupRanges(git, resolved.selected, "net");
      const range = net[0]?.range;
      if (!range?.targetRef) {
        return {
          after: empty,
          before: empty,
          afterIndex: new Map(),
          beforeIndex: new Map(),
        };
      }
      const records = await recordsForRange(git, range);
      const { after, before } = buildIndexes(records);
      return {
        after: { kind: "commit", rev: range.targetRef },
        before: { kind: "commit", rev: range.baseRef },
        afterIndex: after,
        beforeIndex: before,
      };
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
        return {
          after: empty,
          before: empty,
          afterIndex: new Map(),
          beforeIndex: new Map(),
        };
      }
      const net = await resolveCommitGroupRanges(
        git,
        resolved.selected,
        "net",
      );
      const range = net[0]?.range;
      if (!range?.targetRef) {
        return {
          after: empty,
          before: empty,
          afterIndex: new Map(),
          beforeIndex: new Map(),
        };
      }
      const records = await recordsForRange(git, range);
      const { after, before } = buildIndexes(records);
      return {
        after: { kind: "commit", rev: range.targetRef },
        before: { kind: "commit", rev: range.baseRef },
        afterIndex: after,
        beforeIndex: before,
      };
    }
    case "branch": {
      const resolved = await resolveBranchScope(
        git,
        scope.name,
        options.baseBranch ?? null,
      );
      const records = await recordsForRange(git, resolved.range);
      const { after, before } = buildIndexes(records);
      return {
        after: {
          kind: "commit",
          rev: resolved.range.targetRef ?? resolved.range.baseRef,
        },
        before: { kind: "commit", rev: resolved.range.baseRef },
        afterIndex: after,
        beforeIndex: before,
      };
    }
  }
}
