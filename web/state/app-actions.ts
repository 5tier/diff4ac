import type {
  BaseBranch,
  BranchSummary,
  ChangeViewMode,
  CommitSummary,
  Selection,
  SnapshotSide,
  Theme,
  TimeWindow,
} from "../../shared/types";
import type { PanelId } from "../../shared/keymap";
import type { FiltersDraft } from "../FiltersDialog";

export type CursorPanel = "worktrees" | "branches" | "commits" | "files";

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
      readonly type: "toggle-files-view";
      readonly fileCursor: number;
    }
  | { readonly type: "toggle-folder"; readonly key: string }
  | { readonly type: "expand-folder"; readonly key: string }
  | { readonly type: "collapse-folder"; readonly key: string }
  | {
      readonly type: "expand-folders";
      readonly keys: readonly string[];
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
  | { readonly type: "set-selection"; readonly selection: Selection }
  | {
      readonly type: "toggle-code-view";
      readonly path?: string | null;
      readonly line?: number | null;
    }
  | { readonly type: "code-view-side"; readonly side: SnapshotSide }
  | { readonly type: "code-view-focus"; readonly focus: "tree" | "code" }
  | { readonly type: "code-view-cursor"; readonly index: number }
  | { readonly type: "code-view-expand"; readonly keys: readonly string[] }
  | {
      readonly type: "code-view-collapse";
      readonly key: string;
    }
  | { readonly type: "code-view-toggle-folder"; readonly key: string }
  | {
      readonly type: "code-view-open";
      readonly path: string | null;
      readonly line?: number | null;
    }
  | { readonly type: "code-view-line"; readonly line: number }
  | { readonly type: "code-view-full"; readonly full: boolean }
  | { readonly type: "code-view-finder-open" }
  | { readonly type: "code-view-finder-close" }
  | { readonly type: "code-view-finder-query"; readonly value: string }
  | { readonly type: "code-view-finder-index"; readonly index: number }
  | { readonly type: "code-view-notice"; readonly message: string | null }
  | { readonly type: "code-view-help-open" }
  | { readonly type: "code-view-help-close" }
  | { readonly type: "code-view-reset"; readonly keepOpen: boolean }
  | {
      readonly type: "code-view-restore";
      readonly expanded: readonly string[];
      readonly cursor: number;
      readonly openPath: string | null;
      readonly line: number;
    };
