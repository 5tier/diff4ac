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
  readonly diff: string;
  readonly hunks: readonly Hunk[];
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

export type Selection =
  | { readonly kind: "pending" }
  | { readonly kind: "commit"; readonly commit: CommitSummary }
  | {
      readonly kind: "branch";
      readonly branch: BranchSummary;
      readonly baseBranch: BaseBranch;
    };

export interface ChangeSet {
  readonly selection: Selection;
  readonly worktree: WorktreeInfo;
  readonly files: readonly ChangeFile[];
  readonly totals: ChangeTotals;
}

export interface SessionInfo {
  readonly worktree: WorktreeInfo;
  readonly version: string;
}
