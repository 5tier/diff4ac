import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BaseBranch,
  BranchSummary,
  ChangeFile,
  ChangeSet,
  ChangeViewMode,
  CommitChangeGroup,
  FilterRequest,
  CommitSummary,
  FileStatus,
  Selection,
  TimeWindow,
  WorktreeInfo,
  WorktreeSummary,
} from "../src/types";
import { isContiguousCommitSelection } from "../src/changeset/selection";
import {
  createCustomTimeWindow,
  createPresetTimeWindow,
  filterCommitsInTimeWindow,
  localDateInputValue,
  TIME_WINDOW_OPTIONS,
} from "../src/time-windows";
import {
  fetchBranch,
  fetchBranches,
  fetchCommit,
  fetchCommits,
  fetchCommitSet,
  fetchConfig,
  fetchPending,
  fetchTimeWindow,
  fetchWorktreePending,
  fetchWorktrees,
  setReviewMark,
  subscribeRepositoryChanges,
} from "./api";
import {
  applyKeybindingOverrides,
  bindingFor,
  bindingForFilters,
  bindingForTimeWindow,
  bindingsForPanel,
  nextPanel,
  PANEL_LABELS,
  type KeyAction,
  type KeyBinding,
  type KeybindingOverrides,
  type PanelId,
} from "./keymap";
import { FiltersDialog, type FiltersDraft } from "./FiltersDialog";

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
  const reviewed = file.reviewed === true;
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
        title={reviewed ? `${file.path} (reviewed)` : file.path}
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
  keymap,
  onClose,
}: {
  readonly panel: PanelId;
  readonly keymap: readonly KeyBinding[];
  readonly onClose: () => void;
}) {
  const bindings = bindingsForPanel(keymap, panel);

  const renderBindings = (entries: readonly KeyBinding[]) => (
    <ul className="help-list">
      {entries.map((binding) => (
        <li
          className="help-row"
          key={`${binding.panel}:${binding.key}`}
          title={binding.id}
        >
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

interface TimeWindowDialogProps {
  readonly cursor: number;
  readonly mode: "list" | "custom";
  readonly error: string | null;
  readonly customStart: string;
  readonly customEnd: string;
  readonly onChooseOption: (index: number) => void;
  readonly onCustomStartChange: (value: string) => void;
  readonly onCustomEndChange: (value: string) => void;
  readonly onApplyCustom: () => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

function TimeWindowDialog({
  cursor,
  mode,
  error,
  customStart,
  customEnd,
  onChooseOption,
  onCustomStartChange,
  onCustomEndChange,
  onApplyCustom,
  onBack,
  onClose,
}: TimeWindowDialogProps) {
  return (
    <div
      className="time-window-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Time Window"
      data-testid="time-window-dialog"
      data-mode={mode}
      onClick={onClose}
    >
      <div
        className="time-window-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="time-window-header">
          <span>Time Window</span>
          <button type="button" className="time-window-close" onClick={onClose}>
            Close
          </button>
        </header>

        {mode === "list" ? (
          <ul className="time-window-options">
            {TIME_WINDOW_OPTIONS.map((option, index) => (
              <li key={option.preset}>
                <button
                  type="button"
                  className={
                    cursor === index
                      ? "time-window-option time-window-option-cursor"
                      : "time-window-option"
                  }
                  data-preset={option.preset}
                  onClick={() => onChooseOption(index)}
                >
                  <span className="time-window-option-label">
                    {option.label}
                  </span>
                  <span className="time-window-option-description">
                    {option.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form
            className="time-window-custom"
            onSubmit={(event) => {
              event.preventDefault();
              onApplyCustom();
            }}
          >
            <label className="time-window-field">
              <span>Start</span>
              <input
                type="date"
                value={customStart}
                autoFocus
                onChange={(event) =>
                  onCustomStartChange(event.target.value)
                }
              />
            </label>
            <label className="time-window-field">
              <span>End</span>
              <input
                type="date"
                value={customEnd}
                onChange={(event) => onCustomEndChange(event.target.value)}
              />
            </label>
            {error ? <div className="time-window-error">{error}</div> : null}
            <div className="time-window-actions">
              <button type="button" onClick={onBack}>
                Back
              </button>
              <button type="submit">Apply</button>
            </div>
          </form>
        )}
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
    case "time-window":
      return `Time Window · ${selection.window.label}`;
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
    case "time-window":
      return "Time Window";
    case "branch":
      return `Branch ${selection.branch.name}`;
  }
}

function modeLabel(mode: ChangeViewMode): string {
  return mode === "net" ? "Net Diff" : "Commit Stack";
}

function modeStatusLabel(selection: Selection): string | null {
  if (selection.kind !== "commits" && selection.kind !== "time-window") {
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
    case "time-window":
      return selection.commits.length === 0
        ? "No commits landed in this Time Window."
        : "This Time Window has no file changes.";
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
  if (selection.kind === "commits" || selection.kind === "time-window") {
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

function splitGlobLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function activeFilterSummary(filter: FilterRequest | undefined): string {
  if (!filter) {
    return "none";
  }

  const parts: string[] = [];
  if (filter.hideNoise) {
    parts.push("noise on");
  }
  if (filter.disabledExtensions.length > 0) {
    parts.push(
      `${filter.disabledExtensions
        .map((extension) => extension || "(no extension)")
        .join(", ")} off`,
    );
  }
  if (filter.includeGlobs.length > 0) {
    parts.push(`include ${filter.includeGlobs.length}`);
  }
  if (filter.excludeGlobs.length > 0) {
    parts.push(`exclude ${filter.excludeGlobs.length}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "none";
}

function hiddenFilesLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"} hidden`;
}

function selectionFromTimeWindow(
  window: TimeWindow,
  allCommits: readonly CommitSummary[],
): Selection {
  const commits = filterCommitsInTimeWindow(allCommits, window);
  const contiguous = isContiguousCommitSelection(commits);
  return {
    kind: "time-window",
    window,
    commits,
    mode: contiguous ? "net" : "stack",
    contiguous,
  };
}

function sameTimeWindowSelection(
  left: Extract<Selection, { kind: "time-window" }>,
  right: Extract<Selection, { kind: "time-window" }>,
): boolean {
  return (
    left.window.preset === right.window.preset &&
    left.window.start === right.window.start &&
    left.window.end === right.window.end &&
    left.mode === right.mode &&
    left.contiguous === right.contiguous &&
    left.commits.length === right.commits.length &&
    left.commits.every(
      (commit, index) => commit.hash === right.commits[index]?.hash,
    )
  );
}

function isNotFoundError(reason: unknown): boolean {
  return reason instanceof Error && reason.message.startsWith("404:");
}

function missingSelectionLabel(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "This Worktree";
    case "commit":
      return `Commit ${selection.commit.shortHash}`;
    case "commits":
      return `${selection.commits.length} commits`;
    case "time-window":
      return `Time Window ${selection.window.label}`;
    case "branch":
      return `Branch ${selection.branch.name}`;
  }
}

function setChangeFileReviewState(
  changeSet: ChangeSet,
  path: string,
  contentHash: string,
  reviewed: boolean,
): ChangeSet {
  const update = (file: ChangeFile): ChangeFile =>
    file.path === path && file.contentHash === contentHash
      ? { ...file, reviewed }
      : file;

  if (changeSet.commitGroups) {
    const commitGroups = changeSet.commitGroups.map((group) => ({
      ...group,
      files: group.files.map(update),
    }));

    return {
      ...changeSet,
      files: commitGroups.flatMap((group) => group.files),
      commitGroups,
    };
  }

  return { ...changeSet, files: changeSet.files.map(update) };
}

export function App() {
  const [pending, setPending] = useState<ChangeSet | null>(null);
  const [worktrees, setWorktrees] = useState<readonly WorktreeSummary[]>([]);
  const [worktreesError, setWorktreesError] = useState<string | null>(null);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<
    string | null
  >(null);
  const [allCommits, setAllCommits] = useState<readonly CommitSummary[]>([]);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<readonly BranchSummary[]>([]);
  const [baseBranch, setBaseBranch] = useState<BaseBranch | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "pending" });
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [repositoryChanged, setRepositoryChanged] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const [focusedPanel, setFocusedPanel] = useState<PanelId>("files");
  const [keybindingOverrides, setKeybindingOverrides] =
    useState<KeybindingOverrides>({});
  const keymap = useMemo(
    () => applyKeybindingOverrides(keybindingOverrides),
    [keybindingOverrides],
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [disabledExtensions, setDisabledExtensions] = useState<
    readonly string[]
  >([]);
  const [includeGlobs, setIncludeGlobs] = useState("");
  const [excludeGlobs, setExcludeGlobs] = useState("");
  const [hideNoise, setHideNoise] = useState(true);
  const [noisePatterns, setNoisePatterns] = useState<readonly string[]>([]);
  const filterRequest = useMemo<FilterRequest>(
    () => ({
      disabledExtensions,
      includeGlobs: splitGlobLines(includeGlobs),
      excludeGlobs: splitGlobLines(excludeGlobs),
      hideNoise,
    }),
    [disabledExtensions, excludeGlobs, hideNoise, includeGlobs],
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [timeWindowOpen, setTimeWindowOpen] = useState(false);
  const [timeWindowDialogMode, setTimeWindowDialogMode] = useState<
    "list" | "custom"
  >("list");
  const [timeWindowCursor, setTimeWindowCursor] = useState(0);
  const [timeWindowError, setTimeWindowError] = useState<string | null>(null);
  const [timeWindowStart, setTimeWindowStart] = useState(() =>
    localDateInputValue(new Date()),
  );
  const [timeWindowEnd, setTimeWindowEnd] = useState(() =>
    localDateInputValue(new Date()),
  );
  const [worktreeCursor, setWorktreeCursor] = useState(0);
  const [branchCursor, setBranchCursor] = useState(0);
  const [commitCursor, setCommitCursor] = useState(0);
  const [fileCursor, setFileCursor] = useState(0);
  const [pickedHashes, setPickedHashes] = useState<readonly string[]>([]);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const diffRef = useRef<HTMLElement | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  selectedPathRef.current = selectedPath;
  const preserveOnNextLoad = useRef(false);
  const pendingScrollTop = useRef<number | null>(null);

  const agentNames = [
    ...new Set(
      allCommits
        .map((commit) => commit.agent)
        .filter((agent): agent is string => agent !== null),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const commits = agentFilter
    ? allCommits.filter((commit) => commit.agent === agentFilter)
    : allCommits;

  useEffect(() => {
    const controller = new AbortController();

    fetchConfig(controller.signal)
      .then((config) => {
        setKeybindingOverrides(config.keybindings);
        setNoisePatterns(config.noise);
      })
      .catch(() => {
        // Config is optional; defaults remain in force.
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (agentFilter && !allCommits.some((commit) => commit.agent === agentFilter)) {
      setAgentFilter(null);
    }
  }, [agentFilter, allCommits]);

  useEffect(() => {
    const controller = new AbortController();

    fetchCommits(controller.signal, selectedWorktreePath)
      .then((list) => {
        setAllCommits(list.commits);
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
  }, [selectedWorktreePath, refreshVersion]);

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
  }, [refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();

    fetchBranches(controller.signal, selectedWorktreePath)
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
  }, [selectedWorktreePath, refreshVersion]);

  useEffect(() => subscribeRepositoryChanges(() => setRepositoryChanged(true)), []);

  useEffect(() => {
    const controller = new AbortController();
    const preserve = preserveOnNextLoad.current;
    preserveOnNextLoad.current = false;
    const previousPath = selectedPathRef.current;
    const previousScroll = diffRef.current?.scrollTop ?? null;

    setError(null);
    if (!preserve) {
      setLoading(true);
      setChangeSet(null);
      setSelectedPath(null);
      setFileCursor(0);
    }

    const request =
      selection.kind === "pending"
        ? selectedWorktreePath
          ? fetchWorktreePending(
              selectedWorktreePath,
              controller.signal,
              filterRequest,
            )
          : fetchPending(controller.signal, filterRequest)
        : selection.kind === "commit"
          ? fetchCommit(
              selection.commit.hash,
              controller.signal,
              selectedWorktreePath,
              filterRequest,
            )
          : selection.kind === "commits"
            ? fetchCommitSet(
                selection.commits.map((commit) => commit.hash),
                selection.mode,
                controller.signal,
                selectedWorktreePath,
                filterRequest,
              )
            : selection.kind === "time-window"
              ? fetchTimeWindow(
                  selection.window,
                  selection.mode,
                  controller.signal,
                  selectedWorktreePath,
                  agentFilter,
                  filterRequest,
                )
              : fetchBranch(
                  selection.branch.name,
                  controller.signal,
                  selectedWorktreePath,
                  filterRequest,
                );

    request
      .then((loaded) => {
        setChangeSet(loaded);
        setWorktree(loaded.worktree);
        if (loaded.selection.kind === "pending") {
          setPending(loaded);
        }
        if (
          loaded.selection.kind === "time-window" &&
          selection.kind === "time-window" &&
          !sameTimeWindowSelection(selection, loaded.selection)
        ) {
          setSelection(loaded.selection);
        }

        const nextPath =
          preserve &&
          previousPath &&
          loaded.files.some((file) => file.path === previousPath)
            ? previousPath
            : (loaded.files[0]?.path ?? null);
        const nextIndex = nextPath
          ? loaded.files.findIndex((file) => file.path === nextPath)
          : -1;

        setSelectedPath(nextPath);
        setFileCursor(preserve && nextIndex >= 0 ? nextIndex : 0);
        if (preserve && previousScroll !== null) {
          pendingScrollTop.current = previousScroll;
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }

        if (preserve && isNotFoundError(reason)) {
          setRepositoryChanged(false);
          setError(null);
          setLoading(false);
          setPickedHashes([]);
          setRangeAnchor(null);
          setRefreshNotice(
            `${missingSelectionLabel(selection)} no longer exists — showing Pending.`,
          );
          if (selection.kind === "pending") {
            setSelectedWorktreePath(null);
          }
          setSelection({ kind: "pending" });
          return;
        }

        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    return () => controller.abort();
  }, [filterRequest, selection, selectedWorktreePath, refreshVersion]);

  useEffect(() => {
    if (loading || pendingScrollTop.current === null) {
      return;
    }
    const top = pendingScrollTop.current;
    pendingScrollTop.current = null;
    requestAnimationFrame(() => {
      diffRef.current?.scrollTo({ top });
    });
  }, [changeSet, loading]);

  const files = changeSet?.files ?? [];
  const filterInfo = changeSet?.filter;
  const hiddenFiles = filterInfo?.hiddenFiles ?? 0;
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
    (changeSet?.selection.kind === "commits" ||
      changeSet?.selection.kind === "time-window") &&
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

  const applyTimeWindow = useCallback(
    (window: TimeWindow) => {
      setPickedHashes([]);
      setRangeAnchor(null);
      setSelection(selectionFromTimeWindow(window, commits));
      setTimeWindowOpen(false);
      setTimeWindowError(null);
    },
    [commits],
  );

  const openTimeWindows = useCallback(() => {
    const today = localDateInputValue(new Date());
    setTimeWindowDialogMode("list");
    setTimeWindowCursor(0);
    setTimeWindowError(null);
    setTimeWindowStart(today);
    setTimeWindowEnd(today);
    setTimeWindowOpen(true);
  }, []);

  const chooseTimeWindowOption = useCallback(
    (index: number) => {
      const option = TIME_WINDOW_OPTIONS[index];
      if (!option) {
        return;
      }

      if (option.preset === "custom") {
        setTimeWindowDialogMode("custom");
        setTimeWindowError(null);
        return;
      }

      applyTimeWindow(createPresetTimeWindow(option.preset, new Date()));
    },
    [applyTimeWindow],
  );

  const applyCustomTimeWindow = useCallback(() => {
    try {
      applyTimeWindow(createCustomTimeWindow(timeWindowStart, timeWindowEnd));
    } catch (error) {
      setTimeWindowError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [applyTimeWindow, timeWindowEnd, timeWindowStart]);

  const dispatchTimeWindow = useCallback(
    (action: KeyAction) => {
      switch (action.type) {
        case "move":
          setTimeWindowCursor((cursor) =>
            Math.max(
              0,
              Math.min(
                cursor + action.direction,
                TIME_WINDOW_OPTIONS.length - 1,
              ),
            ),
          );
          break;
        case "select":
          chooseTimeWindowOption(timeWindowCursor);
          break;
        case "time-window-close":
          setTimeWindowOpen(false);
          break;
      }
    },
    [chooseTimeWindowOption, timeWindowCursor],
  );

  const applyFilterDraft = useCallback((draft: FiltersDraft) => {
    preserveOnNextLoad.current = true;
    setDisabledExtensions([...new Set(draft.disabledExtensions)]);
    setIncludeGlobs(draft.includeGlobs);
    setExcludeGlobs(draft.excludeGlobs);
    setHideNoise(draft.hideNoise);
    setFiltersOpen(false);
  }, []);

  const refreshRepository = useCallback(() => {
    preserveOnNextLoad.current = true;
    setRepositoryChanged(false);
    setRefreshNotice(null);
    setRefreshVersion((version) => version + 1);
  }, []);

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
          if (
            (selection.kind !== "commits" &&
              selection.kind !== "time-window") ||
            !selection.contiguous
          ) {
            break;
          }
          setSelection({
            ...selection,
            mode: selection.mode === "net" ? "stack" : "net",
          });
          break;
        }
        case "time-windows":
          openTimeWindows();
          break;
        case "cycle-agent-filter": {
          const nextAgent =
            agentNames.length === 0
              ? null
              : agentFilter === null
                ? (agentNames[0] ?? null)
                : (agentNames[agentNames.indexOf(agentFilter) + 1] ?? null);
          setAgentFilter(nextAgent);
          setPickedHashes([]);
          setRangeAnchor(null);

          if (selection.kind === "time-window") {
            const candidates = nextAgent
              ? allCommits.filter((commit) => commit.agent === nextAgent)
              : allCommits;
            setSelection(selectionFromTimeWindow(selection.window, candidates));
          }
          break;
        }
        case "time-window-close":
          setTimeWindowOpen(false);
          break;
        case "filters":
          setFiltersOpen(true);
          break;
        case "filters-close":
          setFiltersOpen(false);
          break;
        case "toggle-noise":
          preserveOnNextLoad.current = true;
          setHideNoise((current) => !current);
          break;
        case "toggle-mark": {
          const file =
            focusedPanel === "diff"
              ? files.find((candidate) => candidate.path === selectedPath)
              : (files[fileCursor] ??
                files.find((candidate) => candidate.path === selectedPath));
          if (!file) {
            break;
          }

          const reviewed = file.reviewed !== true;
          setMarkError(null);
          setChangeSet((current) =>
            current
              ? setChangeFileReviewState(
                  current,
                  file.path,
                  file.contentHash,
                  reviewed,
                )
              : current,
          );

          void setReviewMark(file.path, file.contentHash, reviewed)
            .then(() => setMarkError(null))
            .catch((reason: unknown) => {
              setChangeSet((current) =>
                current
                  ? setChangeFileReviewState(
                      current,
                      file.path,
                      file.contentHash,
                      !reviewed,
                    )
                  : current,
              );
              setMarkError(
                reason instanceof Error ? reason.message : String(reason),
              );
            });
          break;
        }
        case "refresh":
          refreshRepository();
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
      selectedPath,
      selection,
      openTimeWindows,
      refreshRepository,
      agentFilter,
      agentNames,
      allCommits,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (helpOpen) {
        const close = keymap.find(
          (entry) =>
            entry.panel === "global" &&
            entry.action.type === "close-help" &&
            entry.key === event.key,
        );
        if (close) {
          event.preventDefault();
          dispatch(close.action);
        }
        return;
      }

      if (timeWindowOpen) {
        const timeBinding = bindingForTimeWindow(keymap, event.key);
        if (!timeBinding) {
          return;
        }
        if (
          timeWindowDialogMode === "custom" &&
          timeBinding.action.type !== "time-window-close"
        ) {
          return;
        }
        event.preventDefault();
        dispatchTimeWindow(timeBinding.action);
        return;
      }

      if (filtersOpen) {
        const filterBinding = bindingForFilters(keymap, event.key);
        if (filterBinding) {
          event.preventDefault();
          dispatch(filterBinding.action);
        }
        return;
      }

      const binding = bindingFor(keymap, focusedPanel, event.key);
      if (!binding || binding.action.type === "close-help") {
        return;
      }

      event.preventDefault();
      dispatch(binding.action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    dispatch,
    dispatchTimeWindow,
    focusedPanel,
    filtersOpen,
    helpOpen,
    keymap,
    timeWindowDialogMode,
    timeWindowOpen,
  ]);

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

      {repositoryChanged ? (
        <div
          className="repository-banner"
          data-testid="repository-banner"
          role="status"
        >
          Repository changed — press <kbd>r</kbd> to refresh
        </div>
      ) : null}

      {refreshNotice ? (
        <div
          className="repository-notice"
          data-testid="refresh-notice"
          role="status"
        >
          {refreshNotice}
        </div>
      ) : null}

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
              <div className="placeholder">
                {agentFilter
                  ? `No ${agentFilter} commits on this branch.`
                  : "No commits on this branch yet."}
              </div>
            ) : (
              <>
                {(selection.kind === "commits" ||
                  selection.kind === "time-window") &&
                !selection.contiguous ? (
                  <div className="selection-note">
                    Non-contiguous Selection: Commit Stack only.
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
                <div className="placeholder">
                  {hiddenFiles > 0
                    ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
                    : emptyFilesMessage(selection)}
                </div>
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
              <div className="placeholder">
                {hiddenFiles > 0
                  ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
                  : emptyFilesMessage(selection)}
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
          {isStack ? (
            commitGroups.length === 0 ? (
              <div className="diff-empty">
                {hiddenFiles > 0
                  ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
                  : emptyFilesMessage(selection)}
              </div>
            ) : (
              <CommitStackView groups={commitGroups} />
            )
          ) : selected ? (
            <DiffView file={selected} />
          ) : !loading && !error && files.length === 0 ? (
            <div className="diff-empty">
              {hiddenFiles > 0
                ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
                : emptyFilesMessage(selection)}
            </div>
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
          <span
            className="status-selection"
            title={selectionLabel(selection)}
          >
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
        <span
          className="status-filters"
          title={`Filters: ${activeFilterSummary(filterRequest)}`}
        >
          Filters: {activeFilterSummary(filterRequest)}
        </span>
        {hiddenFiles > 0 ? (
          <span className="status-hidden">{hiddenFilesLabel(hiddenFiles)}</span>
        ) : null}
        {markError ? (
          <span className="status-error" title={markError}>
            Review Mark failed
          </span>
        ) : null}
        <span className="status-agent">agent: {agentFilter ?? "all"}</span>
        <span className="status-spacer" />
        <span className="muted">base: {baseBranch?.name ?? "—"}</span>
        <span className="muted">{worktree?.branch ?? ""}</span>
        <span className="muted">read-only · refresh on demand</span>
      </footer>

      {helpOpen ? (
        <HelpOverlay
          panel={focusedPanel}
          keymap={keymap}
          onClose={() => setHelpOpen(false)}
        />
      ) : null}

      {timeWindowOpen ? (
        <TimeWindowDialog
          cursor={timeWindowCursor}
          mode={timeWindowDialogMode}
          error={timeWindowError}
          customStart={timeWindowStart}
          customEnd={timeWindowEnd}
          onChooseOption={chooseTimeWindowOption}
          onCustomStartChange={setTimeWindowStart}
          onCustomEndChange={setTimeWindowEnd}
          onApplyCustom={applyCustomTimeWindow}
          onBack={() => {
            setTimeWindowDialogMode("list");
            setTimeWindowError(null);
          }}
          onClose={() => setTimeWindowOpen(false)}
        />
      ) : null}

      {filtersOpen ? (
        <FiltersDialog
          availableExtensions={filterInfo?.availableExtensions ?? []}
          noisePatterns={noisePatterns}
          initial={{
            disabledExtensions,
            includeGlobs,
            excludeGlobs,
            hideNoise,
          }}
          onApply={applyFilterDraft}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
    </div>
  );
}
