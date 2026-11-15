import type {
  BaseBranch,
  ChangeFile,
  ChangeSet,
  FilterRequest,
  Selection,
  SnapshotSide,
  WatchStatus,
  WorktreeInfo,
} from "../../shared/types";
import type { DiffViewMode } from "../../shared/diff/rows";
import {
  activeFilterSummary,
  hiddenFilesLabel,
  modeStatusLabel,
  selectionBadge,
  selectionLabel,
} from "../state/selection";

export interface StatusBarProps {
  readonly selection: Selection;
  readonly changeSet: ChangeSet | null;
  readonly files: readonly ChangeFile[];
  readonly diffView: DiffViewMode;
  readonly fullFile: boolean;
  readonly filterRequest: FilterRequest;
  readonly hiddenFiles: number;
  readonly searchQuery: string;
  readonly searchMatchCount: number;
  readonly matchIndex: number;
  readonly collapsedSearchFiles: number;
  readonly markError: string | null;
  readonly diffError: string | null;
  readonly agentFilter: string | null;
  readonly baseBranch: BaseBranch | null;
  readonly worktree: WorktreeInfo | null;
  readonly watchStatuses: readonly WatchStatus[];
  readonly codeView?: { readonly side: SnapshotSide; readonly label: string } | null;
}

export function StatusBar({
  selection,
  changeSet,
  files,
  diffView,
  fullFile,
  filterRequest,
  hiddenFiles,
  searchQuery,
  searchMatchCount,
  matchIndex,
  collapsedSearchFiles,
  markError,
  diffError,
  agentFilter,
  baseBranch,
  worktree,
  watchStatuses,
  codeView,
}: StatusBarProps) {
  const degradedWatch = watchStatuses.filter(
    (status) => status.mode !== "native",
  );
  const watchHint = degradedWatch[0];

  return (
    <footer className="status-bar">
      {codeView ? (
        <span className="status-code-view" data-testid="code-view-status">
          Code View · {codeView.side} · {codeView.label}
        </span>
      ) : null}
      <span className="status-badge" title={selectionLabel(selection)}>
        {selectionBadge(selection)}
      </span>
      {selection.kind === "commits" || selection.kind === "time-window" ? (
        <span className="status-mode" title={selectionLabel(selection)}>
          {modeStatusLabel(selection)}
        </span>
      ) : null}
      {selection.kind === "commit" ? (
        <span className="status-selection" title={selection.commit.message}>
          {selection.commit.message}
        </span>
      ) : null}
      {selection.kind === "time-window" ? (
        <span className="status-selection" title={selectionLabel(selection)}>
          {selection.window.label}
        </span>
      ) : null}
      <span>{changeSet?.totals.files ?? 0} files</span>
      <span className="add">+{changeSet?.totals.additions ?? 0}</span>
      <span className="del">−{changeSet?.totals.deletions ?? 0}</span>
      <span className="review-progress">
        {files.filter((file) => file.reviewed === true).length}/
        {files.length} reviewed
      </span>
      <span className="status-view" data-testid="status-view">
        {diffView === "side-by-side" ? "side-by-side" : "unified"} ·{" "}
        {fullFile ? "full file" : "hunks only"}
      </span>
      <span
        className="status-filters"
        title={`Filters: ${activeFilterSummary(filterRequest)}`}
      >
        Filters: {activeFilterSummary(filterRequest)}
      </span>
      {hiddenFiles > 0 ? (
        <span className="status-hidden">{hiddenFilesLabel(hiddenFiles)}</span>
      ) : null}
      {searchQuery.trim() !== "" ? (
        <span
          className="status-search"
          data-testid="search-status"
          title={`Search: ${searchQuery}`}
        >
          /{searchQuery} ·{" "}
          {searchMatchCount === 0
            ? "0 matches"
            : `${Math.max(matchIndex, 0) + 1}/${searchMatchCount} matches`}
        </span>
      ) : null}
      {collapsedSearchFiles > 0 ? (
        <span className="status-hidden" data-testid="search-note">
          search skips {collapsedSearchFiles} collapsed large diff
          {collapsedSearchFiles === 1 ? "" : "s"}
        </span>
      ) : null}
      {markError ? (
        <span className="status-error" title={markError}>
          Review Mark failed
        </span>
      ) : null}
      {diffError ? (
        <span className="status-error" title={diffError}>
          Diff load failed
        </span>
      ) : null}
      {watchHint ? (
        <span
          className="status-watch"
          data-testid="watch-status"
          title={degradedWatch
            .map((status) => `${status.path}: ${status.reason ?? status.mode}`)
            .join("\n")}
        >
          watching: {watchHint.mode}
        </span>
      ) : null}
      <span className="status-agent">agent: {agentFilter ?? "all"}</span>
      <span className="status-spacer" />
      <span className="muted">base: {baseBranch?.name ?? "—"}</span>
      <span className="muted">{worktree?.branch ?? ""}</span>
      <span className="muted">read-only · refresh on demand</span>
    </footer>
  );
}
