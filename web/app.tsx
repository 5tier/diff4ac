import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ChangeFile, ChangeSet, FileStatus } from "../src/types";
import { fetchPending } from "./api";

interface PanelProps {
  readonly title: string;
  readonly count?: number;
  readonly grow?: boolean;
  readonly children: ReactNode;
}

function Panel({ title, count, grow = false, children }: PanelProps) {
  return (
    <section className={grow ? "panel panel-grow" : "panel"}>
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

export function App() {
  const [pending, setPending] = useState<ChangeSet | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    fetchPending(controller.signal)
      .then((changeSet) => {
        setPending(changeSet);
        setSelectedPath(changeSet.files[0]?.path ?? null);
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
  }, []);

  const files = pending?.files ?? [];
  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const branch = pending?.worktree.branch ?? "";

  return (
    <div className="app">
      <header className="top-bar">
        <span className="brand">diff4ac</span>
        <span className="top-bar-path" title={pending?.worktree.path}>
          {pending?.worktree.path ?? ""}
        </span>
        <span className="top-bar-mode">Pending</span>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <Panel title="Worktrees" count={pending ? 1 : undefined}>
            <div className="worktree-row">
              <span className="worktree-icon">▸</span>
              <span className="worktree-branch">{branch || "—"}</span>
              <span className="worktree-pending">{files.length} pending</span>
            </div>
          </Panel>

          <Panel title="Branches">
            <div className="placeholder">Branches arrive in a later ticket.</div>
          </Panel>

          <Panel title="Commits">
            <div className="placeholder">Commits arrive in a later ticket.</div>
          </Panel>

          <Panel title="Files" count={files.length} grow>
            {loading ? (
              <div className="placeholder">Loading Pending…</div>
            ) : error ? (
              <div className="error">{error}</div>
            ) : files.length === 0 ? (
              <div className="placeholder">No Pending changes in this Worktree.</div>
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
        <span className="status-badge">Pending</span>
        <span>{pending?.totals.files ?? 0} files</span>
        <span className="add">+{pending?.totals.additions ?? 0}</span>
        <span className="del">−{pending?.totals.deletions ?? 0}</span>
        <span className="status-spacer" />
        <span className="muted">{branch}</span>
        <span className="muted">read-only · refresh on demand</span>
      </footer>
    </div>
  );
}
