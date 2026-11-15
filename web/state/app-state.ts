import type {
  BaseBranch,
  BranchSummary,
  ChangeViewMode,
  CommitSummary,
  Selection,
  Theme,
  TimeWindow,
} from "../../shared/types";
import type { DiffViewMode } from "../../shared/diff/rows";
import { TIME_WINDOW_OPTIONS } from "../../shared/time-windows";
import { nextPanel, type PanelId } from "../../shared/keymap";
import { nextTheme } from "../theme";
import type { FiltersDraft } from "../FiltersDialog";
import {
  selectionFromPicks,
  selectionFromTimeWindow,
} from "./selection";

export type CursorPanel = "worktrees" | "branches" | "commits" | "files";

export interface AppState {
  readonly focusedPanel: PanelId;
  readonly worktreeCursor: number;
  readonly branchCursor: number;
  readonly commitCursor: number;
  readonly fileCursor: number;
  readonly pickedHashes: readonly string[];
  readonly rangeAnchor: number | null;
  readonly selection: Selection;
  readonly selectedPath: string | null;
  readonly filtersOpen: boolean;
  readonly disabledExtensions: readonly string[];
  readonly includeGlobs: string;
  readonly excludeGlobs: string;
  readonly hideNoise: boolean;
  readonly fullFile: boolean;
  readonly helpOpen: boolean;
  readonly diffView: DiffViewMode;
  readonly theme: Theme;
  readonly timeWindowOpen: boolean;
  readonly timeWindowDialogMode: "list" | "custom";
  readonly timeWindowCursor: number;
  readonly timeWindowError: string | null;
  readonly timeWindowStart: string;
  readonly timeWindowEnd: string;
  readonly searchQuery: string;
  readonly searchOpen: boolean;
  readonly matchIndex: number;
  readonly agentFilter: string | null;
}

export type AppAction =
  | { readonly type: "focus"; readonly panel: PanelId }
  | { readonly type: "cycle"; readonly direction: 1 | -1 }
  | {
      readonly type: "move";
      readonly panel: CursorPanel;
      readonly direction: 1 | -1;
      readonly count: number;
    }
  | {
      readonly type: "move-commit";
      readonly direction: 1 | -1;
      readonly commits: readonly CommitSummary[];
    }
  | { readonly type: "select-worktree"; readonly index: number }
  | {
      readonly type: "select-branch";
      readonly index: number;
      readonly branch: BranchSummary;
      readonly baseBranch: BaseBranch | null;
    }
  | {
      readonly type: "select-commit";
      readonly index: number;
      readonly commit: CommitSummary;
    }
  | {
      readonly type: "select-file";
      readonly index: number;
      readonly path: string;
    }
  | {
      readonly type: "set-file-selection";
      readonly index: number;
      readonly path: string;
    }
  | {
      readonly type: "toggle-pick";
      readonly commit: CommitSummary | undefined;
      readonly commits: readonly CommitSummary[];
      readonly mode: ChangeViewMode;
    }
  | {
      readonly type: "range-pick";
      readonly index: number;
      readonly commit: CommitSummary | undefined;
    }
  | { readonly type: "toggle-mode" }
  | {
      readonly type: "cycle-agent-filter";
      readonly agents: readonly string[];
      readonly allCommits: readonly CommitSummary[];
    }
  | { readonly type: "set-agent-filter"; readonly agent: string | null }
  | { readonly type: "open-time-windows"; readonly today: string }
  | { readonly type: "close-time-window" }
  | { readonly type: "time-window-move"; readonly direction: 1 | -1 }
  | { readonly type: "time-window-custom-mode" }
  | {
      readonly type: "apply-time-window";
      readonly window: TimeWindow;
      readonly commits: readonly CommitSummary[];
    }
  | { readonly type: "time-window-error"; readonly message: string | null }
  | { readonly type: "time-window-start"; readonly value: string }
  | { readonly type: "time-window-end"; readonly value: string }
  | { readonly type: "time-window-back" }
  | { readonly type: "filters-open" }
  | { readonly type: "filters-close" }
  | { readonly type: "apply-filter-draft"; readonly draft: FiltersDraft }
  | { readonly type: "toggle-noise" }
  | { readonly type: "toggle-full-file" }
  | { readonly type: "toggle-diff-view" }
  | { readonly type: "cycle-theme" }
  | { readonly type: "set-theme"; readonly theme: Theme }
  | { readonly type: "help-open" }
  | { readonly type: "help-close" }
  | { readonly type: "search-open" }
  | { readonly type: "search-query"; readonly value: string }
  | { readonly type: "search-commit" }
  | { readonly type: "search-clear" }
  | { readonly type: "set-match-index"; readonly index: number }
  | { readonly type: "clamp-match-index"; readonly count: number }
  | {
      readonly type: "clamp-cursor";
      readonly panel: CursorPanel;
      readonly count: number;
    }
  | {
      readonly type: "set-cursor";
      readonly panel: CursorPanel;
      readonly index: number;
    }
  | { readonly type: "load-start"; readonly preserve: boolean }
  | {
      readonly type: "change-set-loaded";
      readonly selectedPath: string | null;
      readonly fileCursor: number;
      readonly selection?: Selection;
    }
  | { readonly type: "selection-missing" }
  | { readonly type: "set-selection"; readonly selection: Selection };

function clampCursor(value: number, count: number): number {
  return Math.max(0, Math.min(value, count - 1));
}

function cursorFor(
  state: AppState,
  panel: CursorPanel,
): number {
  switch (panel) {
    case "worktrees":
      return state.worktreeCursor;
    case "branches":
      return state.branchCursor;
    case "commits":
      return state.commitCursor;
    case "files":
      return state.fileCursor;
  }
}

function withCursor(
  state: AppState,
  panel: CursorPanel,
  value: number,
): AppState {
  switch (panel) {
    case "worktrees":
      return { ...state, worktreeCursor: value };
    case "branches":
      return { ...state, branchCursor: value };
    case "commits":
      return { ...state, commitCursor: value };
    case "files":
      return { ...state, fileCursor: value };
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "focus":
      return { ...state, focusedPanel: action.panel, rangeAnchor: null };
    case "cycle":
      return {
        ...state,
        focusedPanel: nextPanel(state.focusedPanel, action.direction),
        rangeAnchor: null,
      };
    case "move":
      return withCursor(
        state,
        action.panel,
        clampCursor(
          cursorFor(state, action.panel) + action.direction,
          action.count,
        ),
      );
    case "move-commit": {
      const nextCursor = clampCursor(
        state.commitCursor + action.direction,
        action.commits.length,
      );
      const next = { ...state, commitCursor: nextCursor };
      if (state.rangeAnchor === null) {
        return next;
      }
      const start = Math.min(state.rangeAnchor, nextCursor);
      const end = Math.max(state.rangeAnchor, nextCursor);
      const hashes = action.commits
        .slice(start, end + 1)
        .map((commit) => commit.hash);
      return {
        ...next,
        pickedHashes: hashes,
        selection: selectionFromPicks(action.commits, hashes, "net"),
      };
    }
    case "select-worktree":
      return {
        ...state,
        focusedPanel: "worktrees",
        worktreeCursor: action.index,
        pickedHashes: [],
        rangeAnchor: null,
        selection: { kind: "pending" },
      };
    case "select-branch":
      return {
        ...state,
        focusedPanel: "branches",
        branchCursor: action.index,
        pickedHashes: [],
        rangeAnchor: null,
        selection: action.baseBranch
          ? {
              kind: "branch",
              branch: action.branch,
              baseBranch: action.baseBranch,
            }
          : state.selection,
      };
    case "select-commit":
      return {
        ...state,
        focusedPanel: "commits",
        commitCursor: action.index,
        rangeAnchor: null,
        pickedHashes: [action.commit.hash],
        selection: { kind: "commit", commit: action.commit },
      };
    case "select-file":
      return {
        ...state,
        focusedPanel: "files",
        fileCursor: action.index,
        selectedPath: action.path,
      };
    case "set-file-selection":
      return {
        ...state,
        fileCursor: action.index,
        selectedPath: action.path,
      };
    case "toggle-pick": {
      if (!action.commit) {
        return state;
      }
      const picked = action.commit.hash;
      const next = state.pickedHashes.includes(picked)
        ? state.pickedHashes.filter((hash) => hash !== picked)
        : [...state.pickedHashes, picked];
      return {
        ...state,
        rangeAnchor: null,
        pickedHashes: next,
        selection: selectionFromPicks(action.commits, next, action.mode),
      };
    }
    case "range-pick":
      if (!action.commit) {
        return state;
      }
      return {
        ...state,
        rangeAnchor: action.index,
        pickedHashes: [action.commit.hash],
        selection: { kind: "commit", commit: action.commit },
      };
    case "toggle-mode": {
      if (
        (state.selection.kind !== "commits" &&
          state.selection.kind !== "time-window") ||
        !state.selection.contiguous
      ) {
        return state;
      }
      return {
        ...state,
        selection: {
          ...state.selection,
          mode: state.selection.mode === "net" ? "stack" : "net",
        },
      };
    }
    case "cycle-agent-filter": {
      const nextAgent =
        action.agents.length === 0
          ? null
          : state.agentFilter === null
            ? (action.agents[0] ?? null)
            : (action.agents[action.agents.indexOf(state.agentFilter) + 1] ??
              null);

      let selection = state.selection;
      if (selection.kind === "time-window") {
        const candidates = nextAgent
          ? action.allCommits.filter((commit) => commit.agent === nextAgent)
          : action.allCommits;
        selection = selectionFromTimeWindow(selection.window, candidates);
      }

      return {
        ...state,
        agentFilter: nextAgent,
        pickedHashes: [],
        rangeAnchor: null,
        selection,
      };
    }
    case "set-agent-filter":
      return { ...state, agentFilter: action.agent };
    case "open-time-windows":
      return {
        ...state,
        timeWindowDialogMode: "list",
        timeWindowCursor: 0,
        timeWindowError: null,
        timeWindowStart: action.today,
        timeWindowEnd: action.today,
        timeWindowOpen: true,
      };
    case "close-time-window":
      return { ...state, timeWindowOpen: false };
    case "time-window-move":
      return {
        ...state,
        timeWindowCursor: clampCursor(
          state.timeWindowCursor + action.direction,
          TIME_WINDOW_OPTIONS.length,
        ),
      };
    case "time-window-custom-mode":
      return {
        ...state,
        timeWindowDialogMode: "custom",
        timeWindowError: null,
      };
    case "apply-time-window":
      return {
        ...state,
        pickedHashes: [],
        rangeAnchor: null,
        selection: selectionFromTimeWindow(action.window, action.commits),
        timeWindowOpen: false,
        timeWindowError: null,
      };
    case "time-window-error":
      return { ...state, timeWindowError: action.message };
    case "time-window-start":
      return { ...state, timeWindowStart: action.value };
    case "time-window-end":
      return { ...state, timeWindowEnd: action.value };
    case "time-window-back":
      return {
        ...state,
        timeWindowDialogMode: "list",
        timeWindowError: null,
      };
    case "filters-open":
      return { ...state, filtersOpen: true };
    case "filters-close":
      return { ...state, filtersOpen: false };
    case "apply-filter-draft":
      return {
        ...state,
        disabledExtensions: [...new Set(action.draft.disabledExtensions)],
        includeGlobs: action.draft.includeGlobs,
        excludeGlobs: action.draft.excludeGlobs,
        hideNoise: action.draft.hideNoise,
        filtersOpen: false,
      };
    case "toggle-noise":
      return { ...state, hideNoise: !state.hideNoise };
    case "toggle-full-file":
      return { ...state, fullFile: !state.fullFile };
    case "toggle-diff-view":
      return {
        ...state,
        diffView:
          state.diffView === "unified" ? "side-by-side" : "unified",
      };
    case "cycle-theme":
      return { ...state, theme: nextTheme(state.theme) };
    case "set-theme":
      return { ...state, theme: action.theme };
    case "help-open":
      return { ...state, helpOpen: true };
    case "help-close":
      return { ...state, helpOpen: false };
    case "search-open":
      return { ...state, searchOpen: true };
    case "search-query":
      return {
        ...state,
        searchQuery: action.value,
        matchIndex: action.value.trim() === "" ? -1 : 0,
      };
    case "search-commit":
      return { ...state, searchOpen: false };
    case "search-clear":
      return {
        ...state,
        searchQuery: "",
        searchOpen: false,
        matchIndex: -1,
      };
    case "set-match-index":
      return { ...state, matchIndex: action.index };
    case "clamp-match-index":
      return {
        ...state,
        matchIndex:
          action.count === 0
            ? -1
            : state.matchIndex < 0 || state.matchIndex >= action.count
              ? 0
              : state.matchIndex,
      };
    case "clamp-cursor":
      return withCursor(
        state,
        action.panel,
        clampCursor(cursorFor(state, action.panel), action.count),
      );
    case "set-cursor":
      return withCursor(state, action.panel, action.index);
    case "load-start":
      if (action.preserve) {
        return state;
      }
      return { ...state, selectedPath: null, fileCursor: 0 };
    case "change-set-loaded":
      return {
        ...state,
        selectedPath: action.selectedPath,
        fileCursor: action.fileCursor,
        ...(action.selection ? { selection: action.selection } : {}),
      };
    case "selection-missing":
      return {
        ...state,
        pickedHashes: [],
        rangeAnchor: null,
        selection: { kind: "pending" },
      };
    case "set-selection":
      return { ...state, selection: action.selection };
  }
}

export { createInitialAppState } from "./initial-state";
