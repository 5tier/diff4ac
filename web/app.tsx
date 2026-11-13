import { useEffect, useState } from "react";
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

interface PanelProps {
  readonly title: string;
  readonly count?: number;
  readonly grow?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

function Panel({
  title,
  count,
  grow = false,
  className,
  children,
}: PanelProps) {
  const classes = ["panel", grow ? "panel-grow" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes}>
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
  onSelect,
}: {
  readonly file: ChangeFile;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={selected ? "file-row file-row-selected" : "file-row"}
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
  onSelect,
}: {
  readonly commit: CommitSummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={selected ? "commit-row commit-row-selected" : "commit-row"}
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
          <Panel title="Worktrees" count={1}>
            <button
              type="button"
              className={
                selection.kind === "pending"
                  ? "worktree-row worktree-row-selected"
                  : "worktree-row"
              }
              onClick={() => setSelection({ kind: "pending" })}
            >
              <span className="worktree-icon">▸</span>
              <span className="worktree-branch">{worktree?.branch ?? "—"}</span>
              <span className="worktree-pending">{pendingCount} pending</span>
            </button>
          </Panel>

          <Panel title="Branches">
            <div className="placeholder">Branches arrive in a later ticket.</div>
          </Panel>

          <Panel title="Commits" count={commits.length} className="panel-commits">
            {commitsError ? (
              <div className="error">{commitsError}</div>
            ) : commits.length === 0 ? (
              <div className="placeholder">No commits on this branch yet.</div>
            ) : (
              <ul className="commit-list">
                {commits.map((commit) => (
                  <CommitRow
                    key={commit.hash}
                    commit={commit}
                    selected={
                      selection.kind === "commit" &&
                      selection.commit.hash === commit.hash
                    }
                    onSelect={() => setSelection({ kind: "commit", commit })}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Files" count={files.length} grow>
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
                {files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    selected={file.path === selectedPath}
                    onSelect={() => setSelectedPath(file.path)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </aside>

        <main className="diff-pane">
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
    </div>
  );
}
