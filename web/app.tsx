import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BaseBranch,
  BranchSummary,
  ChangeFile,
  ChangeSet,
  ChangeViewMode,
  CommitChangeGroup,
  CommitSummary,
  FileStatus,
  Selection,
  WorktreeInfo,
  WorktreeSummary,
} from "../src/types";
import { isContiguousCommitSelection } from "../src/changeset/selection";
import {
  fetchBranch,
  fetchBranches,
  fetchCommit,
  fetchCommits,
  fetchCommitSet,
  fetchPending,
  fetchWorktreePending,
  fetchWorktrees,
} from "./api";
import {
  bindingFor,
  bindingsForPanel,
  nextPanel,
  PANEL_LABELS,
  type KeyAction,
  type KeyBinding,
  type PanelId,
} from "./keymap";

interface PanelProps {
  readonly id: PanelId;
  readonly title: string;
  readonly count?: number;
  readonly grow?: boolean;
  readonly focused: boolean;
  readonly cursor?: number;
  readonly className?: string;
  readonly children: ReactNode;
}

function Panel({
  id,
  title,
  count,
  grow = false,
  focused,
  cursor,
  className,
  children,
}: PanelProps) {
  const classes = [
    "panel",
    grow ? "panel-grow" : "",
    focused ? "panel-focused" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={classes}
      data-panel={id}
      data-focused={focused ? "true" : "false"}
      data-cursor={cursor}
    >
      <header className="panel-title">
        <span>{title}</span>
        {count !== undefined ? <span className="panel-count">{count}</span> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

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

function FileRow({
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
  const classes = [
    "file-row",
    selected ? "file-row-selected" : "",
    cursor ? "file-row-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <button
        type="button"
        className={classes}
        onClick={onSelect}
        title={file.path}
      >
        <span className={`file-status file-status-${file.status}`}>
          {STATUS_LABEL[file.status]}
        </span>
        <span className="file-path">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="file-counts">
          {file.binary ? (
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

function CommitRow({
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
        </span>
      </button>
    </li>
  );
}

function WorktreeRow({
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

function BranchRow({
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

function diffLineClass(line: string): string {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("similarity index") ||
    line.startsWith("rename from") ||
    line.startsWith("rename to") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode")
  ) {
    return "diff-line diff-meta";
  }
  if (line.startsWith("@@")) {
    return "diff-line diff-hunk";
  }
  if (line.startsWith("+")) {
    return "diff-line diff-add";
  }
  if (line.startsWith("-")) {
    return "diff-line diff-del";
  }
  return "diff-line diff-context";
}

function DiffView({
  file,
  id,
}: {
  readonly file: ChangeFile;
  readonly id?: string;
}) {
  return (
    <div className="diff-view" id={id}>
      <div className="diff-heading">
        <span className="diff-heading-path">
          {file.oldPath ? (
            <>
              <span className="muted">{file.oldPath}</span>
              <span className="diff-arrow"> → </span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        <span className="file-counts">
          <span className="add">+{file.additions}</span>
          <span className="del">−{file.deletions}</span>
        </span>
      </div>

      {file.binary ? (
        <div className="diff-empty">Binary file changed — preview not available yet.</div>
      ) : (
        <div className="diff-lines">
          {file.diff.split("\n").map((line, index) => (
            <div key={index} className={diffLineClass(line)}>
              {line === "" ? "\u00a0" : line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function stackFileId(commitHash: string, path: string): string {
  return `stack-${commitHash}-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function stackFileIndices(
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

function CommitStackView({
  groups,
}: {
  readonly groups: readonly CommitChangeGroup[];
}) {
  if (groups.length === 0) {
    return <div className="diff-empty">No commit changes.</div>;
  }

  return (
    <div className="commit-stack">
      {groups.map((group) => (
        <section className="commit-stack-group" key={group.commit.hash}>
          <header className="commit-stack-heading">
            <span className="commit-hash">{group.commit.shortHash}</span>
            <span className="commit-stack-message">{group.commit.message}</span>
            <span className="file-counts">
              <span className="muted">{group.totals.files} files</span>
              <span className="add">+{group.totals.additions}</span>
              <span className="del">−{group.totals.deletions}</span>
            </span>
          </header>
          {group.files.length === 0 ? (
            <div className="diff-empty">No file changes in this commit.</div>
          ) : (
            group.files.map((file) => (
              <DiffView
                key={`${group.commit.hash}:${file.path}`}
                id={stackFileId(group.commit.hash, file.path)}
                file={file}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function HelpOverlay({
  panel,
  onClose,
}: {
  readonly panel: PanelId;
  readonly onClose: () => void;
}) {
  const bindings = bindingsForPanel(panel);

  const renderBindings = (entries: readonly KeyBinding[]) => (
    <ul className="help-list">
      {entries.map((binding) => (
        <li className="help-row" key={`${binding.panel}:${binding.key}`}>
          <kbd className="help-key">
            {binding.key === " " ? "Space" : binding.key}
          </kbd>
          <span className="help-label">{binding.label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Keybindings for ${PANEL_LABELS[panel]}`}
      data-testid="help-overlay"
      onClick={onClose}
    >
      <div className="help-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="help-header">
          <span>Keybindings · {PANEL_LABELS[panel]}</span>
          <button type="button" className="help-close" onClick={onClose}>
            Close
          </button>
        </header>

        {bindings.panel.length > 0 ? (
          <section className="help-section">
            <h2>{PANEL_LABELS[panel]}</h2>
            {renderBindings(bindings.panel)}
          </section>
        ) : null}

        <section className="help-section">
          <h2>Global</h2>
          {renderBindings(bindings.global)}
        </section>
      </div>
    </div>
  );
}

function selectionLabel(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "Pending";
    case "commit":
      return `Commit ${selection.commit.shortHash} · ${selection.commit.message}`;
    case "commits":
      return `${selection.commits.length} commits · ${modeLabel(selection.mode)}`;
    case "branch":
      return `Branch ${selection.branch.name} since ${selection.baseBranch.name}`;
  }
}

function selectionBadge(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "Pending";
    case "commit":
      return `Commit ${selection.commit.shortHash}`;
    case "commits":
      return `Commits ${selection.commits.length}`;
    case "branch":
      return `Branch ${selection.branch.name}`;
  }
}

function modeLabel(mode: ChangeViewMode): string {
  return mode === "net" ? "Net Diff" : "Commit Stack";
}

function modeStatusLabel(selection: Selection): string | null {
  if (selection.kind !== "commits") {
    return null;
  }
  return selection.contiguous
    ? modeLabel(selection.mode)
    : `${modeLabel(selection.mode)} (non-contiguous)`;
}

function emptyFilesMessage(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "No Pending changes in this Worktree.";
    case "commit":
      return "This commit has no file changes.";
    case "commits":
      return "These commits have no file changes.";
    case "branch":
      return selection.branch.name === selection.baseBranch.name
        ? "No changes: this is the Base Branch."
        : "No changes since the Base Branch.";
  }
}

function selectionIncludesCommit(selection: Selection, hash: string): boolean {
  if (selection.kind === "commit") {
    return selection.commit.hash === hash;
  }
  if (selection.kind === "commits") {
    return selection.commits.some((commit) => commit.hash === hash);
  }
  return false;
}

function selectionFromPicks(
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

export function App() {
  const [pending, setPending] = useState<ChangeSet | null>(null);
  const [worktrees, setWorktrees] = useState<readonly WorktreeSummary[]>([]);
  const [worktreesError, setWorktreesError] = useState<string | null>(null);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<
    string | null
  >(null);
  const [commits, setCommits] = useState<readonly CommitSummary[]>([]);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<readonly BranchSummary[]>([]);
  const [baseBranch, setBaseBranch] = useState<BaseBranch | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "pending" });
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [focusedPanel, setFocusedPanel] = useState<PanelId>("files");
  const [helpOpen, setHelpOpen] = useState(false);
  const [worktreeCursor, setWorktreeCursor] = useState(0);
  const [branchCursor, setBranchCursor] = useState(0);
  const [commitCursor, setCommitCursor] = useState(0);
  const [fileCursor, setFileCursor] = useState(0);
  const [pickedHashes, setPickedHashes] = useState<readonly string[]>([]);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const diffRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchCommits(controller.signal)
      .then((list) => {
        setCommits(list.commits);
        setWorktree(list.worktree);
        setCommitsError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setCommitsError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchWorktrees(controller.signal)
      .then((list) => {
        setWorktrees(list.worktrees);
        setWorktreesError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setWorktreesError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchBranches(controller.signal)
      .then((list) => {
        setBranches(list.branches);
        setBaseBranch(list.baseBranch);
        setWorktree(list.worktree);
        setBranchesError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setBranchesError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setChangeSet(null);
    setSelectedPath(null);
    setFileCursor(0);

    const request =
      selection.kind === "pending"
        ? selectedWorktreePath
          ? fetchWorktreePending(selectedWorktreePath, controller.signal)
          : fetchPending(controller.signal)
        : selection.kind === "commit"
          ? fetchCommit(selection.commit.hash, controller.signal)
          : selection.kind === "commits"
            ? fetchCommitSet(
                selection.commits.map((commit) => commit.hash),
                selection.mode,
                controller.signal,
              )
            : fetchBranch(selection.branch.name, controller.signal);

    request
      .then((loaded) => {
        setChangeSet(loaded);
        setWorktree(loaded.worktree);
        if (loaded.selection.kind === "pending") {
          setPending(loaded);
        }
        setSelectedPath(loaded.files[0]?.path ?? null);
        setFileCursor(0);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    return () => controller.abort();
  }, [selection, selectedWorktreePath]);

  const files = changeSet?.files ?? [];
  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const selectedWorktree =
    selection.kind === "pending"
      ? (selectedWorktreePath ??
        pending?.worktree.path ??
        changeSet?.worktree.path ??
        worktrees.find((worktree) => worktree.current)?.path ??
        worktree?.path ??
        null)
      : null;

  useEffect(() => {
    setWorktreeCursor((cursor) =>
      Math.max(0, Math.min(cursor, worktrees.length - 1)),
    );
  }, [worktrees.length]);

  useEffect(() => {
    if (selectedWorktreePath) {
      return;
    }
    const currentIndex = worktrees.findIndex((worktree) => worktree.current);
    if (currentIndex >= 0) {
      setWorktreeCursor(currentIndex);
    }
  }, [selectedWorktreePath, worktrees]);
  const commitGroups = changeSet?.commitGroups ?? [];
  const isStack =
    changeSet?.selection.kind === "commits" &&
    changeSet.selection.mode === "stack";
  const stackFileIndex = stackFileIndices(commitGroups);

  useEffect(() => {
    setBranchCursor((cursor) =>
      Math.max(0, Math.min(cursor, branches.length - 1)),
    );
  }, [branches.length]);

  useEffect(() => {
    setCommitCursor((cursor) =>
      Math.max(0, Math.min(cursor, commits.length - 1)),
    );
  }, [commits.length]);

  useEffect(() => {
    setFileCursor((cursor) =>
      Math.max(0, Math.min(cursor, files.length - 1)),
    );
  }, [files.length]);

  const dispatch = useCallback(
    (action: KeyAction) => {
      switch (action.type) {
        case "focus":
          setFocusedPanel(action.panel);
          setRangeAnchor(null);
          break;
        case "cycle":
          setFocusedPanel((current) => nextPanel(current, action.direction));
          setRangeAnchor(null);
          break;
        case "move":
          if (focusedPanel === "branches") {
            setBranchCursor((cursor) =>
              Math.max(
                0,
                Math.min(cursor + action.direction, branches.length - 1),
              ),
            );
          } else if (focusedPanel === "commits") {
            const nextCursor = Math.max(
              0,
              Math.min(commitCursor + action.direction, commits.length - 1),
            );
            setCommitCursor(nextCursor);

            if (rangeAnchor !== null) {
              const start = Math.min(rangeAnchor, nextCursor);
              const end = Math.max(rangeAnchor, nextCursor);
              const hashes = commits
                .slice(start, end + 1)
                .map((commit) => commit.hash);
              setPickedHashes(hashes);
              setSelection(selectionFromPicks(commits, hashes, "net"));
            }
          } else if (focusedPanel === "files") {
            setFileCursor((cursor) =>
              Math.max(
                0,
                Math.min(cursor + action.direction, files.length - 1),
              ),
            );
          } else if (focusedPanel === "worktrees") {
            setWorktreeCursor((cursor) =>
              Math.max(
                0,
                Math.min(cursor + action.direction, worktrees.length - 1),
              ),
            );
          }
          break;
        case "select":
          if (focusedPanel === "worktrees") {
            const worktree = worktrees[worktreeCursor];
            if (worktree) {
              setSelectedWorktreePath(worktree.path);
              setPickedHashes([]);
              setRangeAnchor(null);
              setSelection({ kind: "pending" });
            }
          } else if (focusedPanel === "branches") {
            const branch = branches[branchCursor];
            if (branch && baseBranch) {
              setPickedHashes([]);
              setRangeAnchor(null);
              setSelection({ kind: "branch", branch, baseBranch });
            }
          } else if (focusedPanel === "commits") {
            const commit = commits[commitCursor];
            if (commit) {
              setRangeAnchor(null);
              setPickedHashes([commit.hash]);
              setSelection({ kind: "commit", commit });
            }
          } else if (focusedPanel === "files") {
            const file = files[fileCursor];
            if (file) {
              setSelectedPath(file.path);
            }
          }
          break;
        case "toggle-pick": {
          if (focusedPanel !== "commits") {
            break;
          }
          const commit = commits[commitCursor];
          if (!commit) {
            break;
          }

          setRangeAnchor(null);
          const next = pickedHashes.includes(commit.hash)
            ? pickedHashes.filter((hash) => hash !== commit.hash)
            : [...pickedHashes, commit.hash];
          setPickedHashes(next);
          setSelection(selectionFromPicks(commits, next, "net"));
          break;
        }
        case "range-pick": {
          if (focusedPanel !== "commits") {
            break;
          }
          const commit = commits[commitCursor];
          if (!commit) {
            break;
          }

          setRangeAnchor(commitCursor);
          setPickedHashes([commit.hash]);
          setSelection({ kind: "commit", commit });
          break;
        }
        case "toggle-mode": {
          if (selection.kind !== "commits" || !selection.contiguous) {
            break;
          }
          setSelection({
            ...selection,
            mode: selection.mode === "net" ? "stack" : "net",
          });
          break;
        }
        case "scroll":
          diffRef.current?.scrollBy({ top: action.direction * 96 });
          break;
        case "help":
          setHelpOpen(true);
          break;
        case "close-help":
          setHelpOpen(false);
          break;
      }
    },
    [
      baseBranch,
      branches,
      branchCursor,
      commits,
      commitCursor,
      files,
      fileCursor,
      focusedPanel,
      selectedWorktreePath,
      worktrees,
      worktreeCursor,
      pickedHashes,
      rangeAnchor,
      selection,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const binding = bindingFor(focusedPanel, event.key);
      if (!binding) {
        return;
      }

      if (helpOpen) {
        event.preventDefault();
        if (binding.action.type === "close-help") {
          dispatch(binding.action);
        }
        return;
      }

      if (binding.action.type === "close-help") {
        return;
      }

      event.preventDefault();
      dispatch(binding.action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, focusedPanel, helpOpen]);

  return (
    <div className="app">
      <header className="top-bar">
        <span className="brand">diff4ac</span>
        <span className="top-bar-path" title={worktree?.path}>
          {worktree?.path ?? ""}
        </span>
        <span className="top-bar-mode" title={selectionLabel(selection)}>
          {selectionBadge(selection)}
        </span>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <Panel
            id="worktrees"
            title="Worktrees"
            count={worktrees.length}
            focused={focusedPanel === "worktrees"}
            cursor={worktreeCursor}
            className="panel-worktrees"
          >
            {worktreesError ? (
              <div className="error">{worktreesError}</div>
            ) : worktrees.length === 0 ? (
              <div className="placeholder">Loading Worktrees…</div>
            ) : (
              <ul className="worktree-list">
                {worktrees.map((worktree, index) => (
                  <WorktreeRow
                    key={worktree.path}
                    worktree={worktree}
                    selected={selectedWorktree === worktree.path}
                    cursor={worktreeCursor === index}
                    onSelect={() => {
                      setFocusedPanel("worktrees");
                      setWorktreeCursor(index);
                      setSelectedWorktreePath(worktree.path);
                      setPickedHashes([]);
                      setRangeAnchor(null);
                      setSelection({ kind: "pending" });
                    }}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            id="branches"
            title="Branches"
            count={branches.length}
            focused={focusedPanel === "branches"}
            cursor={branchCursor}
            className="panel-branches"
          >
            {branchesError ? (
              <div className="error">{branchesError}</div>
            ) : branches.length === 0 ? (
              <div className="placeholder">No local branches.</div>
            ) : (
              <>
                {baseBranch ? null : (
                  <div className="placeholder">
                    Base Branch not detected (no origin/HEAD, main or master).
                  </div>
                )}
                <ul className="branch-list">
                  {branches.map((branch, index) => (
                    <BranchRow
                      key={branch.name}
                      branch={branch}
                      cursor={branchCursor === index}
                      selected={
                        selection.kind === "branch" &&
                        selection.branch.name === branch.name
                      }
                      disabled={baseBranch === null}
                      onSelect={() => {
                        setFocusedPanel("branches");
                        setBranchCursor(index);
                        setPickedHashes([]);
                        setRangeAnchor(null);
                        if (baseBranch) {
                          setSelection({ kind: "branch", branch, baseBranch });
                        }
                      }}
                    />
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            id="commits"
            title="Commits"
            count={commits.length}
            focused={focusedPanel === "commits"}
            cursor={commitCursor}
            className="panel-commits"
          >
            {commitsError ? (
              <div className="error">{commitsError}</div>
            ) : commits.length === 0 ? (
              <div className="placeholder">No commits on this branch yet.</div>
            ) : (
              <>
                {selection.kind === "commits" && !selection.contiguous ? (
                  <div className="selection-note">
                    Non-contiguous picks: Commit Stack only.
                  </div>
                ) : null}
                <ul className="commit-list">
                  {commits.map((commit, index) => (
                    <CommitRow
                      key={commit.hash}
                      commit={commit}
                      selected={selectionIncludesCommit(selection, commit.hash)}
                      cursor={commitCursor === index}
                      onSelect={() => {
                        setFocusedPanel("commits");
                        setCommitCursor(index);
                        setRangeAnchor(null);
                        setPickedHashes([commit.hash]);
                        setSelection({ kind: "commit", commit });
                      }}
                    />
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            id="files"
            title="Files"
            count={files.length}
            grow
            focused={focusedPanel === "files"}
            cursor={fileCursor}
          >
            {loading ? (
              <div className="placeholder">Loading Change Set…</div>
            ) : error ? (
              <div className="error">{error}</div>
            ) : isStack ? (
              commitGroups.length === 0 ? (
                <div className="placeholder">{emptyFilesMessage(selection)}</div>
              ) : (
                <div className="stack-file-list">
                  {commitGroups.map((group) => (
                    <section
                      className="stack-file-group"
                      key={group.commit.hash}
                    >
                      <div
                        className="stack-file-heading"
                        title={group.commit.message}
                      >
                        <span className="commit-hash">
                          {group.commit.shortHash}
                        </span>
                        <span className="stack-file-message">
                          {group.commit.message}
                        </span>
                      </div>
                      {group.files.length === 0 ? (
                        <div className="placeholder">No file changes.</div>
                      ) : (
                        <ul className="file-list">
                          {group.files.map((file) => {
                            const key = `${group.commit.hash}:${file.path}`;
                            const index = stackFileIndex.get(key) ?? 0;
                            return (
                              <FileRow
                                key={key}
                                file={file}
                                selected={file.path === selectedPath}
                                cursor={fileCursor === index}
                                onSelect={() => {
                                  setFocusedPanel("files");
                                  setFileCursor(index);
                                  setSelectedPath(file.path);
                                  document
                                    .getElementById(
                                      stackFileId(
                                        group.commit.hash,
                                        file.path,
                                      ),
                                    )
                                    ?.scrollIntoView({ block: "start" });
                                }}
                              />
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              )
            ) : files.length === 0 ? (
              <div className="placeholder">{emptyFilesMessage(selection)}</div>
            ) : (
              <ul className="file-list">
                {files.map((file, index) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    selected={file.path === selectedPath}
                    cursor={fileCursor === index}
                    onSelect={() => {
                      setFocusedPanel("files");
                      setFileCursor(index);
                      setSelectedPath(file.path);
                    }}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </aside>

        <main
          ref={diffRef}
          className={
            focusedPanel === "diff" ? "diff-pane diff-pane-focused" : "diff-pane"
          }
          data-panel="diff"
          data-focused={focusedPanel === "diff" ? "true" : "false"}
        >
          {isStack ? (
            <CommitStackView groups={commitGroups} />
          ) : selected ? (
            <DiffView file={selected} />
          ) : (
            <div className="diff-empty">
              {error
                ? "Could not load the Change Set."
                : "Select a file to see its unified diff."}
            </div>
          )}
        </main>
      </div>

      <footer className="status-bar">
        <span className="status-badge" title={selectionLabel(selection)}>
          {selectionBadge(selection)}
        </span>
        {selection.kind === "commits" ? (
          <span className="status-mode" title={selectionLabel(selection)}>
            {modeStatusLabel(selection)}
          </span>
        ) : null}
        {selection.kind === "commit" ? (
          <span className="status-selection" title={selection.commit.message}>
            {selection.commit.message}
          </span>
        ) : null}
        <span>{changeSet?.totals.files ?? 0} files</span>
        <span className="add">+{changeSet?.totals.additions ?? 0}</span>
        <span className="del">−{changeSet?.totals.deletions ?? 0}</span>
        <span className="status-spacer" />
        <span className="muted">base: {baseBranch?.name ?? "—"}</span>
        <span className="muted">{worktree?.branch ?? ""}</span>
        <span className="muted">read-only · refresh on demand</span>
      </footer>

      {helpOpen ? (
        <HelpOverlay panel={focusedPanel} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}
