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

export interface ChangeSet {
  readonly selection: { readonly kind: "pending" };
  readonly worktree: {
    readonly path: string;
    readonly branch: string;
  };
  readonly files: readonly ChangeFile[];
  readonly totals: {
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
  };
}

export interface SessionInfo {
  readonly worktree: {
    readonly path: string;
    readonly branch: string;
  };
  readonly version: string;
}
