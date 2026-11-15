import type {
  BranchSummary,
  ChangeFile,
  CommitSummary,
  FileStatus,
  WorktreeSummary,
} from "../../shared/types";
import {
  describeModeChange,
  isModeOnlyChange,
  modeChangeFor,
} from "../../shared/diff/mode";

const STATUS_LABEL: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechanged: "T",
  unmerged: "U",
  untracked: "?",
};

export function FileRow({
  file,
  selected,
  cursor,
  onSelect,
}: {
  readonly file: ChangeFile;
  readonly selected: boolean;
  readonly cursor: boolean;
  readonly onSelect: () => void;
}) {
  const reviewed = file.reviewed === true;
  const modeOnly = isModeOnlyChange(file);
  const modeChange = modeChangeFor(file);
  const title = reviewed ? `${file.path} (reviewed)` : file.path;
  const classes = [
    "file-row",
    selected ? "file-row-selected" : "",
    cursor ? "file-row-cursor" : "",
    reviewed ? "file-row-reviewed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <button
        type="button"
        className={classes}
        onClick={onSelect}
        title={
          modeChange ? `${title}\n${describeModeChange(modeChange)}` : title
        }
        data-mode-only={modeOnly ? "true" : undefined}
      >
        <span className={`file-status file-status-${file.status}`}>
          {STATUS_LABEL[file.status]}
        </span>
        <span className="file-review" aria-hidden="true">
          {reviewed ? "✓" : ""}
        </span>
        <span className="file-path">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="file-counts">
          {modeOnly ? (
            <span className="file-mode">mode</span>
          ) : file.binary ? (
            <span className="binary">bin</span>
          ) : (
            <>
              <span className="add">+{file.additions}</span>
              <span className="del">−{file.deletions}</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

export function CommitRow({
  commit,
  selected,
  cursor,
  onSelect,
}: {
  readonly commit: CommitSummary;
  readonly selected: boolean;
  readonly cursor: boolean;
  readonly onSelect: () => void;
}) {
  const classes = [
    "commit-row",
    selected ? "commit-row-selected" : "",
    cursor ? "commit-row-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <button
        type="button"
        className={classes}
        onClick={onSelect}
        title={`${commit.message}\n${commit.author.name} <${commit.author.email}>\n${commit.hash}`}
      >
        <span className="commit-line">
          <span className="commit-hash">{commit.shortHash}</span>
          <span className="commit-message">{commit.message}</span>
        </span>
        <span className="commit-meta">
          {commit.author.name} · {commit.relativeDate}
          {commit.agent ? (
            <span
              className="commit-agent"
              data-agent={commit.agent}
              title={`Agent Commit: ${commit.agent}`}
            >
              {" "}🤖 {commit.agent}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function WorktreeRow({
  worktree,
  selected,
  cursor,
  onSelect,
}: {
  readonly worktree: WorktreeSummary;
  readonly selected: boolean;
  readonly cursor: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={[
          "worktree-row",
          selected ? "worktree-row-selected" : "",
          cursor ? "worktree-row-cursor" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-worktree-path={worktree.path}
        data-pending-count={worktree.pendingCount}
        onClick={onSelect}
        title={`${worktree.path}\n${worktree.branch ?? `detached HEAD ${worktree.shortHead}`}`}
      >
        <span className={worktree.current ? "worktree-current" : "worktree-icon"}>
          {worktree.current ? "●" : "▸"}
        </span>
        <span className="worktree-info">
          <span className="worktree-path">{worktree.path}</span>
          <span className="worktree-branch">
            {worktree.branch ?? `detached HEAD · ${worktree.shortHead}`}
          </span>
        </span>
        <span className="worktree-pending">{worktree.pendingCount} pending</span>
      </button>
    </li>
  );
}

export function BranchRow({
  branch,
  selected,
  cursor,
  disabled,
  onSelect,
}: {
  readonly branch: BranchSummary;
  readonly selected: boolean;
  readonly cursor: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={[
          "branch-row",
          selected ? "branch-row-selected" : "",
          cursor ? "branch-row-cursor" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={onSelect}
        disabled={disabled}
        data-branch-name={branch.name}
        data-current={branch.current ? "true" : "false"}
        title={`${branch.name}${branch.current ? " (current)" : ""}\n${branch.hash}`}
      >
        <span className={branch.current ? "branch-current" : "branch-marker"}>
          {branch.current ? "●" : " "}
        </span>
        <span className="branch-name">{branch.name}</span>
        <span className="branch-hash">{branch.shortHash}</span>
      </button>
    </li>
  );
}
