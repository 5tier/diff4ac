import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ChangeFile,
  ChangeSet,
  CommitSummary,
  FileStatus,
  Selection,
  WorktreeInfo,
} from "../src/types";
import { fetchCommit, fetchCommits, fetchPending } from "./api";
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

function DiffView({ file }: { readonly file: ChangeFile }) {
  return (
    <div className="diff-view">
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
          <kbd className="help-key">{binding.key}</kbd>
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
  if (selection.kind === "pending") {
    return "Pending";
  }
  return `Commit ${selection.commit.shortHash} · ${selection.commit.message}`;
}

function selectionBadge(selection: Selection): string {
  return selection.kind === "pending"
    ? "Pending"
    : `Commit ${selection.commit.shortHash}`;
}

export function App() {
  const [pending, setPending] = useState<ChangeSet | null>(null);
  const [commits, setCommits] = useState<readonly CommitSummary[]>([]);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "pending" });
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [focusedPanel, setFocusedPanel] = useState<PanelId>("files");
  const [helpOpen, setHelpOpen] = useState(false);
  const [worktreeCursor, setWorktreeCursor] = useState(0);
  const [commitCursor, setCommitCursor] = useState(0);
  const [fileCursor, setFileCursor] = useState(0);
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
    setLoading(true);
    setError(null);
    setChangeSet(null);
    setSelectedPath(null);
    setFileCursor(0);

    const request =
      selection.kind === "pending"
        ? fetchPending(controller.signal)
        : fetchCommit(selection.commit.hash, controller.signal);

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
  }, [selection]);

  const files = changeSet?.files ?? [];
  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const pendingCount = pending?.totals.files ?? 0;

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
          break;
        case "cycle":
          setFocusedPanel((current) => nextPanel(current, action.direction));
          break;
        case "move":
          if (focusedPanel === "commits") {
            setCommitCursor((cursor) =>
              Math.max(
                0,
                Math.min(cursor + action.direction, commits.length - 1),
              ),
            );
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
                Math.min(cursor + action.direction, 0),
              ),
            );
          }
          break;
        case "select":
          if (focusedPanel === "worktrees") {
            setWorktreeCursor(0);
            setSelection({ kind: "pending" });
          } else if (focusedPanel === "commits") {
            const commit = commits[commitCursor];
            if (commit) {
              setSelection({ kind: "commit", commit });
            }
          } else if (focusedPanel === "files") {
            const file = files[fileCursor];
            if (file) {
              setSelectedPath(file.path);
            }
          }
          break;
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
    [commits, commitCursor, files, fileCursor, focusedPanel],
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
            count={1}
            focused={focusedPanel === "worktrees"}
            cursor={worktreeCursor}
          >
            <button
              type="button"
              className={[
                "worktree-row",
                selection.kind === "pending" ? "worktree-row-selected" : "",
                worktreeCursor === 0 ? "worktree-row-cursor" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                setFocusedPanel("worktrees");
                setWorktreeCursor(0);
                setSelection({ kind: "pending" });
              }}
            >
              <span className="worktree-icon">▸</span>
              <span className="worktree-branch">{worktree?.branch ?? "—"}</span>
              <span className="worktree-pending">{pendingCount} pending</span>
            </button>
          </Panel>

          <Panel
            id="branches"
            title="Branches"
            focused={focusedPanel === "branches"}
          >
            <div className="placeholder">Branches arrive in a later ticket.</div>
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
              <ul className="commit-list">
                {commits.map((commit, index) => (
                  <CommitRow
                    key={commit.hash}
                    commit={commit}
                    selected={
                      selection.kind === "commit" &&
                      selection.commit.hash === commit.hash
                    }
                    cursor={commitCursor === index}
                    onSelect={() => {
                      setFocusedPanel("commits");
                      setCommitCursor(index);
                      setSelection({ kind: "commit", commit });
                    }}
                  />
                ))}
              </ul>
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
            ) : files.length === 0 ? (
              <div className="placeholder">
                {selection.kind === "pending"
                  ? "No Pending changes in this Worktree."
                  : "This commit has no file changes."}
              </div>
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
          {selected ? (
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
        {selection.kind === "commit" ? (
          <span className="status-selection" title={selection.commit.message}>
            {selection.commit.message}
          </span>
        ) : null}
        <span>{changeSet?.totals.files ?? 0} files</span>
        <span className="add">+{changeSet?.totals.additions ?? 0}</span>
        <span className="del">−{changeSet?.totals.deletions ?? 0}</span>
        <span className="status-spacer" />
        <span className="muted">{worktree?.branch ?? ""}</span>
        <span className="muted">read-only · refresh on demand</span>
      </footer>

      {helpOpen ? (
        <HelpOverlay panel={focusedPanel} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}
