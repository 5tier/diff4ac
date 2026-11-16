import type { CompiledAgentPattern } from "../agents";
import type { GitGateway } from "../git/gateway";
import {
  commitPositions,
  firstParent,
  listCommitsInWindow,
  readCommitsByHash,
  UnknownCommitError,
} from "../repository/commits";
import type {
  ChangeSet,
  ChangeViewMode,
  CommitChangeGroup,
  CommitSummary,
  Selection,
  TimeWindow,
  WorktreeInfo,
} from "../../shared/types";
import { resolveCommitRange } from "./commit";
import { buildChangeFilesForRange } from "./files";
import { emptyTreeRef } from "./objects";
import type { ChangeFileOptions, DiffRange } from "./types";
import { changeSetTotals } from "./totals";
import { isContiguousCommitSelection } from "../../shared/changeset/selection";

export class NonContiguousNetDiffError extends Error {
  constructor() {
    super("Net Diff is not available for a non-contiguous commit Selection");
    this.name = "NonContiguousNetDiffError";
  }
}

export interface CommitGroupRange {
  readonly range: DiffRange;
  readonly commit?: CommitSummary;
}

/**
 * The ranges a commit Selection covers, in Change Set order: one net range, or
 * one range per commit group (oldest first) in Commit Stack mode.
 */
export async function resolveCommitGroupRanges(
  git: GitGateway,
  selected: readonly CommitSummary[],
  mode: ChangeViewMode,
): Promise<readonly CommitGroupRange[]> {
  if (mode === "net") {
    const newest = selected[0];
    const oldest = selected.at(-1);
    if (!newest || !oldest) {
      throw new Error("commit Selection is empty");
    }

    const parent = await firstParent(git, oldest.hash);
    return [
      {
        range: {
          baseRef: parent ?? (await emptyTreeRef(git)),
          targetRef: newest.hash,
          oldRev: parent,
          newRev: newest.hash,
        },
      },
    ];
  }

  const ranges: CommitGroupRange[] = [];
  for (const commit of [...selected].reverse()) {
    ranges.push({
      range: await resolveCommitRange(git, commit.hash),
      commit,
    });
  }
  return ranges;
}

async function buildSelectedCommitsChangeSet(
  git: GitGateway,
  worktree: WorktreeInfo,
  selected: readonly CommitSummary[],
  mode: ChangeViewMode,
  selection: Selection,
  options: ChangeFileOptions = {},
): Promise<ChangeSet> {
  const ranges = await resolveCommitGroupRanges(git, selected, mode);

  if (mode === "net") {
    const range = ranges[0]?.range;
    if (!range) {
      throw new Error("commit Selection is empty");
    }
    const files = await buildChangeFilesForRange(git, range, options);

    return {
      selection,
      worktree,
      files,
      totals: changeSetTotals(files),
    };
  }

  const commitGroups: CommitChangeGroup[] = [];
  for (const { commit, range } of ranges) {
    if (!commit) {
      continue;
    }
    const files = await buildChangeFilesForRange(git, range, options);
    commitGroups.push({ commit, files, totals: changeSetTotals(files) });
  }

  const files = commitGroups.flatMap((group) => group.files);
  return {
    selection,
    worktree,
    files,
    totals: changeSetTotals(files),
    commitGroups,
  };
}

export interface CommitsChangeSetOptions extends ChangeFileOptions {
  readonly agentPatterns?: readonly CompiledAgentPattern[];
}

export interface SelectedCommitsScope {
  readonly selection: Selection;
  readonly worktree: WorktreeInfo;
  readonly selected: readonly CommitSummary[];
}

export async function resolveSelectedCommits(
  git: GitGateway,
  hashes: readonly string[],
  mode: ChangeViewMode,
  options: CommitsChangeSetOptions = {},
): Promise<SelectedCommitsScope> {
  if (hashes.length === 0) {
    throw new Error("commit Selection is empty");
  }

  const positions = await commitPositions(git);
  const missing = hashes.find((hash) => !positions.has(hash));
  if (missing) {
    throw new UnknownCommitError(missing);
  }

  const byHash = await readCommitsByHash(git, hashes, {
    agentPatterns: options.agentPatterns,
  });

  const selected: CommitSummary[] = [];
  const seen = new Set<string>();
  for (const hash of hashes) {
    const commit = byHash.get(hash);
    if (!commit) {
      throw new UnknownCommitError(hash);
    }
    if (!seen.has(hash)) {
      seen.add(hash);
      selected.push(commit);
    }
  }

  selected.sort(
    (a, b) => (positions.get(a.hash) ?? 0) - (positions.get(b.hash) ?? 0),
  );

  const contiguous = isContiguousCommitSelection(selected);
  if (!contiguous && mode === "net") {
    throw new NonContiguousNetDiffError();
  }

  const selection: Selection = {
    kind: "commits",
    commits: selected,
    mode,
    contiguous,
  };

  return {
    selection,
    worktree: {
      path: git.worktreeRoot,
      branch: await git.currentBranch(),
    },
    selected,
  };
}

export async function buildCommitsChangeSet(
  git: GitGateway,
  hashes: readonly string[],
  mode: ChangeViewMode,
  options: CommitsChangeSetOptions = {},
): Promise<ChangeSet> {
  const { selection, worktree, selected } = await resolveSelectedCommits(
    git,
    hashes,
    mode,
    options,
  );

  return buildSelectedCommitsChangeSet(
    git,
    worktree,
    selected,
    mode,
    selection,
    options,
  );
}

export interface TimeWindowChangeSetOptions extends ChangeFileOptions {
  readonly agentPatterns?: readonly CompiledAgentPattern[];
  readonly agent?: string;
}

export interface TimeWindowScope {
  readonly selection: Selection;
  readonly worktree: WorktreeInfo;
  readonly selected: readonly CommitSummary[];
  readonly mode: ChangeViewMode;
}

export async function resolveTimeWindowScope(
  git: GitGateway,
  window: TimeWindow,
  requestedMode: ChangeViewMode | "auto" = "auto",
  options: TimeWindowChangeSetOptions = {},
): Promise<TimeWindowScope> {
  const list = await listCommitsInWindow(git, window, {
    agentPatterns: options.agentPatterns,
    agent: options.agent,
  });
  const selected = list.commits;
  const contiguous = isContiguousCommitSelection(selected);
  const mode =
    requestedMode === "auto" || (requestedMode === "net" && !contiguous)
      ? contiguous
        ? "net"
        : "stack"
      : requestedMode;

  const selection: Selection = {
    kind: "time-window",
    window,
    commits: selected,
    mode,
    contiguous,
  };

  return { selection, worktree: list.worktree, selected, mode };
}

export async function buildTimeWindowChangeSet(
  git: GitGateway,
  window: TimeWindow,
  requestedMode: ChangeViewMode | "auto" = "auto",
  options: TimeWindowChangeSetOptions = {},
): Promise<ChangeSet> {
  const { selection, worktree, selected, mode } = await resolveTimeWindowScope(
    git,
    window,
    requestedMode,
    options,
  );

  if (selected.length === 0) {
    return {
      selection,
      worktree,
      files: [],
      totals: changeSetTotals([]),
      ...(mode === "stack" ? { commitGroups: [] } : {}),
    };
  }

  return buildSelectedCommitsChangeSet(
    git,
    worktree,
    selected,
    mode,
    selection,
    options,
  );
}
