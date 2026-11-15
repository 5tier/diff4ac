import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  BaseBranch,
  BranchSummary,
  ChangeFile,
  ChangeSet,
  CommitSummary,
  WorktreeSummary,
} from "../../shared/types";
import type { FileRequestContext } from "../api";
import type { KeyAction, PanelId } from "../../shared/keymap";
import type { ToolbarItem } from "../../shared/toolbar";
import type { SearchFile, SearchMatch } from "../../shared/diff/search";
import type { HunkLocation } from "../../shared/diff/navigation";
import type { AppAction, AppState } from "../state/app-state";
import type { FiltersDraft } from "../FiltersDialog";
import type { FileTreeModel } from "../state/file-tree";

export interface UseActionsParams {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly files: readonly ChangeFile[];
  readonly fileTreeModel: FileTreeModel;
  readonly fileContext: FileRequestContext;
  readonly setChangeSet: Dispatch<SetStateAction<ChangeSet | null>>;
  readonly setDiffError: Dispatch<SetStateAction<string | null>>;
  readonly setMarkError: Dispatch<SetStateAction<string | null>>;
  readonly commits: readonly CommitSummary[];
  readonly allCommits: readonly CommitSummary[];
  readonly hasMoreCommits: boolean;
  readonly loadMoreCommits: () => void;
  readonly agentNames: readonly string[];
  readonly branches: readonly BranchSummary[];
  readonly baseBranch: BaseBranch | null;
  readonly worktrees: readonly WorktreeSummary[];
  readonly searchFiles: readonly SearchFile[];
  readonly searchMatches: readonly SearchMatch[];
  readonly currentDiffFileKey: () => string | null;
  readonly currentHunkLocation: () => HunkLocation | null;
  readonly jumpToMatch: (index: number) => void;
  readonly jumpToTarget: (
    fileKey: string,
    row: number,
    fileCursor?: number,
  ) => void;
  readonly clearSearch: () => void;
  readonly refreshRepository: () => void;
  readonly markPreserve: () => void;
  readonly setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
  readonly diffRef: MutableRefObject<HTMLElement | null>;
}

export interface ActionDispatcher {
  readonly dispatch: (action: KeyAction, panel?: PanelId) => void;
  readonly dispatchTimeWindow: (action: KeyAction) => void;
  readonly chooseTimeWindowOption: (index: number) => void;
  readonly applyCustomTimeWindow: () => void;
  readonly applyFilterDraft: (draft: FiltersDraft) => void;
  readonly closeTimeWindow: () => void;
  readonly runToolbarAction: (item: ToolbarItem) => void;
}
