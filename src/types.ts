export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechanged"
  | "unmerged"
  | "untracked";

export type HunkLineType = "context" | "add" | "delete";

export interface HunkLine {
  readonly type: HunkLineType;
  readonly content: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface Hunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly HunkLine[];
}

export interface ChangeFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly image?: boolean;
  readonly diff: string;
  readonly hunks: readonly Hunk[];
  readonly contentHash: string;
  readonly oldSize?: number;
  readonly newSize?: number;
  readonly oldRev?: string;
  readonly newRev?: string;
  readonly collapsed?: boolean;
  readonly reviewed?: boolean;
}

export interface ChangeTotals {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface WorktreeInfo {
  readonly path: string;
  readonly branch: string;
}

export interface WorktreeSummary {
  readonly path: string;
  readonly branch: string | null;
  readonly head: string;
  readonly shortHead: string;
  readonly pendingCount: number;
  readonly current: boolean;
}

export interface WorktreeList {
  readonly worktrees: readonly WorktreeSummary[];
}

export interface CommitAuthor {
  readonly name: string;
  readonly email: string;
}

export interface CommitSummary {
  readonly hash: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: CommitAuthor;
  readonly committedAt: string;
  readonly relativeDate: string;
  readonly firstParent: string | null;
  readonly agent: string | null;
}

export interface CommitList {
  readonly worktree: WorktreeInfo;
  readonly commits: readonly CommitSummary[];
}

export interface BranchSummary {
  readonly name: string;
  readonly hash: string;
  readonly shortHash: string;
  readonly current: boolean;
}

export interface BaseBranch {
  readonly name: string;
  readonly ref: string;
}

export interface BranchList {
  readonly worktree: WorktreeInfo;
  readonly baseBranch: BaseBranch | null;
  readonly branches: readonly BranchSummary[];
}

export type ChangeViewMode = "net" | "stack";

export type TimeWindowPreset = "today" | "yesterday" | "last-24h" | "custom";

export interface TimeWindow {
  readonly preset: TimeWindowPreset;
  readonly start: string;
  readonly end: string;
  readonly label: string;
}

export interface CommitChangeGroup {
  readonly commit: CommitSummary;
  readonly files: readonly ChangeFile[];
  readonly totals: ChangeTotals;
}

export type Selection =
  | { readonly kind: "pending" }
  | { readonly kind: "commit"; readonly commit: CommitSummary }
  | {
      readonly kind: "commits";
      readonly commits: readonly CommitSummary[];
      readonly mode: ChangeViewMode;
      readonly contiguous: boolean;
    }
  | {
      readonly kind: "time-window";
      readonly window: TimeWindow;
      readonly commits: readonly CommitSummary[];
      readonly mode: ChangeViewMode;
      readonly contiguous: boolean;
    }
  | {
      readonly kind: "branch";
      readonly branch: BranchSummary;
      readonly baseBranch: BaseBranch;
    };

export interface FilterRequest {
  readonly disabledExtensions: readonly string[];
  readonly includeGlobs: readonly string[];
  readonly excludeGlobs: readonly string[];
  readonly hideNoise: boolean;
}

export interface FilterInfo extends FilterRequest {
  readonly availableExtensions: readonly string[];
  readonly hiddenFiles: number;
}

export interface ChangeSet {
  readonly selection: Selection;
  readonly worktree: WorktreeInfo;
  readonly files: readonly ChangeFile[];
  readonly totals: ChangeTotals;
  readonly commitGroups?: readonly CommitChangeGroup[];
  readonly filter?: FilterInfo;
}

export interface SessionInfo {
  readonly worktree: WorktreeInfo;
  readonly version: string;
}

export interface ConfigDiagnostic {
  readonly file: string;
  readonly field: string;
  readonly message: string;
}

export interface AgentPatternConfig {
  readonly name: string;
  readonly trailers: readonly string[];
  readonly authors: readonly string[];
}

export interface ConfigInfo {
  readonly baseBranch: string | null;
  readonly baseBranchFile?: string;
  readonly keybindings: Readonly<Record<string, string>>;
  readonly agents: readonly AgentPatternConfig[];
  readonly noise: readonly string[];
  readonly diagnostics: readonly ConfigDiagnostic[];
}
