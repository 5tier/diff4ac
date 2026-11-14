import type { CompiledAgentPattern } from "../agents";
import type { GitGateway } from "../git/gateway";
import {
  firstParent,
  listCommits,
  listCommitsInWindow,
} from "../repository/commits";
import type {
  ChangeSet,
  ChangeViewMode,
  CommitChangeGroup,
  CommitSummary,
  Selection,
  TimeWindow,
  WorktreeInfo,
} from "../types";
import { buildCommitFiles } from "./commit";
import {
  buildChangeFilesForRange,
  changeSetTotals,
  emptyTreeRef,
  type ChangeFileOptions,
} from "./files";
import { isContiguousCommitSelection } from "./selection";

export class NonContiguousNetDiffError extends Error {
  constructor() {
    super("Net Diff is not available for a non-contiguous commit Selection");
    this.name = "NonContiguousNetDiffError";
  }
}

async function buildSelectedCommitsChangeSet(
  git: GitGateway,
  worktree: WorktreeInfo,
  selected: readonly CommitSummary[],
  mode: ChangeViewMode,
  selection: Selection,
  options: ChangeFileOptions = {},
): Promise<ChangeSet> {
  if (mode === "net") {
    const newest = selected[0];
    const oldest = selected.at(-1);
    if (!newest || !oldest) {
      throw new Error("commit Selection is empty");
    }

    const parent = await firstParent(git, oldest.hash);
    const baseRef = parent ?? (await emptyTreeRef(git));
    const files = await buildChangeFilesForRange(
      git,
      {
        baseRef,
        targetRef: newest.hash,
        oldRev: parent,
        newRev: newest.hash,
      },
      options,
    );

    return {
      selection,
      worktree,
      files,
      totals: changeSetTotals(files),
    };
  }

  const commitGroups: CommitChangeGroup[] = [];
  for (const commit of [...selected].reverse()) {
    const { files, totals } = await buildCommitFiles(git, commit, options);
    commitGroups.push({ commit, files, totals });
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

export async function buildCommitsChangeSet(
  git: GitGateway,
  hashes: readonly string[],
  mode: ChangeViewMode,
  options: CommitsChangeSetOptions = {},
): Promise<ChangeSet> {
  if (hashes.length === 0) {
    throw new Error("commit Selection is empty");
  }

  const list = await listCommits(git, {
    agentPatterns: options.agentPatterns,
  });
  const positions = new Map(
    list.commits.map((commit, index) => [commit.hash, index] as const),
  );
  const byHash = new Map(list.commits.map((commit) => [commit.hash, commit] as const));

  const selected: CommitSummary[] = [];
  const seen = new Set<string>();
  for (const hash of hashes) {
    const commit = byHash.get(hash);
    if (!commit) {
      throw new Error(`commit "${hash}" was not found`);
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

  return buildSelectedCommitsChangeSet(
    git,
    list.worktree,
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

export async function buildTimeWindowChangeSet(
  git: GitGateway,
  window: TimeWindow,
  requestedMode: ChangeViewMode | "auto" = "auto",
  options: TimeWindowChangeSetOptions = {},
): Promise<ChangeSet> {
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

  if (selected.length === 0) {
    return {
      selection,
      worktree: list.worktree,
      files: [],
      totals: changeSetTotals([]),
      ...(mode === "stack" ? { commitGroups: [] } : {}),
    };
  }

  return buildSelectedCommitsChangeSet(
    git,
    list.worktree,
    selected,
    mode,
    selection,
    options,
  );
}
