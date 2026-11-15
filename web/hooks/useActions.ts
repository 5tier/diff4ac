import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  BaseBranch,
  BranchSummary,
  ChangeFile,
  ChangeSet,
  CommitSummary,
  WorktreeSummary,
} from "../../shared/types";
import {
  createCustomTimeWindow,
  createPresetTimeWindow,
  localDateInputValue,
  TIME_WINDOW_OPTIONS,
} from "../../shared/time-windows";
import {
  fetchFileDiff,
  setReviewMark,
  type FileRequestContext,
} from "../api";
import type { KeyAction, PanelId } from "../../shared/keymap";
import type { ToolbarItem } from "../../shared/toolbar";
import { nextTheme, storeTheme } from "../theme";
import { stepMatchIndex } from "../../shared/diff/search";
import type { SearchFile, SearchMatch } from "../../shared/diff/search";
import {
  nextFileTarget,
  nextHunkTarget,
  type HunkLocation,
} from "../../shared/diff/navigation";
import type { AppAction, AppState } from "../state/app-state";
import type { FiltersDraft } from "../FiltersDialog";
import {
  replaceChangeFile,
  setChangeFileReviewState,
} from "../state/selection";

export interface UseActionsParams {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly files: readonly ChangeFile[];
  readonly fileContext: FileRequestContext;
  readonly setChangeSet: Dispatch<SetStateAction<ChangeSet | null>>;
  readonly setDiffError: Dispatch<SetStateAction<string | null>>;
  readonly setMarkError: Dispatch<SetStateAction<string | null>>;
  readonly commits: readonly CommitSummary[];
  readonly allCommits: readonly CommitSummary[];
  readonly agentNames: readonly string[];
  readonly branches: readonly BranchSummary[];
  readonly baseBranch: BaseBranch | null;
  readonly worktrees: readonly WorktreeSummary[];
  readonly searchFiles: readonly SearchFile[];
  readonly searchMatches: readonly SearchMatch[];
  readonly currentDiffFileKey: () => string | null;
  readonly currentHunkLocation: () => HunkLocation | null;
  readonly jumpToMatch: (index: number) => void;
  readonly jumpToTarget: (fileKey: string, row: number) => void;
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

export function useActions({
  state,
  appDispatch,
  files,
  fileContext,
  setChangeSet,
  setDiffError,
  setMarkError,
  commits,
  allCommits,
  agentNames,
  branches,
  baseBranch,
  worktrees,
  searchFiles,
  searchMatches,
  currentDiffFileKey,
  currentHunkLocation,
  jumpToMatch,
  jumpToTarget,
  clearSearch,
  refreshRepository,
  markPreserve,
  setSelectedWorktreePath,
  diffRef,
}: UseActionsParams): ActionDispatcher {
  const chooseTimeWindowOption = useCallback(
    (index: number) => {
      const option = TIME_WINDOW_OPTIONS[index];
      if (!option) {
        return;
      }

      if (option.preset === "custom") {
        appDispatch({ type: "time-window-custom-mode" });
        return;
      }

      appDispatch({
        type: "apply-time-window",
        window: createPresetTimeWindow(option.preset, new Date()),
        commits,
      });
    },
    [appDispatch, commits],
  );

  const applyCustomTimeWindow = useCallback(() => {
    try {
      appDispatch({
        type: "apply-time-window",
        window: createCustomTimeWindow(
          state.timeWindowStart,
          state.timeWindowEnd,
        ),
        commits,
      });
    } catch (error) {
      appDispatch({
        type: "time-window-error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [appDispatch, commits, state.timeWindowEnd, state.timeWindowStart]);

  const dispatchTimeWindow = useCallback(
    (action: KeyAction) => {
      switch (action.type) {
        case "move":
          appDispatch({
            type: "time-window-move",
            direction: action.direction,
          });
          break;
        case "select":
          chooseTimeWindowOption(state.timeWindowCursor);
          break;
        case "time-window-close":
          appDispatch({ type: "close-time-window" });
          break;
      }
    },
    [appDispatch, chooseTimeWindowOption, state.timeWindowCursor],
  );

  const applyFilterDraft = useCallback(
    (draft: FiltersDraft) => {
      markPreserve();
      appDispatch({ type: "apply-filter-draft", draft });
    },
    [appDispatch, markPreserve],
  );

  const dispatch = useCallback(
    (action: KeyAction, panel: PanelId = state.focusedPanel) => {
      switch (action.type) {
        case "focus":
          appDispatch({ type: "focus", panel: action.panel });
          break;
        case "cycle":
          appDispatch({ type: "cycle", direction: action.direction });
          break;
        case "move":
          if (panel === "branches") {
            appDispatch({
              type: "move",
              panel: "branches",
              direction: action.direction,
              count: branches.length,
            });
          } else if (panel === "commits") {
            appDispatch({
              type: "move-commit",
              direction: action.direction,
              commits,
            });
          } else if (panel === "files") {
            appDispatch({
              type: "move",
              panel: "files",
              direction: action.direction,
              count: files.length,
            });
          } else if (panel === "worktrees") {
            appDispatch({
              type: "move",
              panel: "worktrees",
              direction: action.direction,
              count: worktrees.length,
            });
          }
          break;
        case "select":
          if (panel === "worktrees") {
            const worktree = worktrees[state.worktreeCursor];
            if (worktree) {
              setSelectedWorktreePath(worktree.path);
              appDispatch({
                type: "select-worktree",
                index: state.worktreeCursor,
              });
            }
          } else if (panel === "branches") {
            const branch = branches[state.branchCursor];
            if (branch && baseBranch) {
              appDispatch({
                type: "select-branch",
                index: state.branchCursor,
                branch,
                baseBranch,
              });
            }
          } else if (panel === "commits") {
            const commit = commits[state.commitCursor];
            if (commit) {
              appDispatch({
                type: "select-commit",
                index: state.commitCursor,
                commit,
              });
            }
          } else if (panel === "files") {
            const file = files[state.fileCursor];
            if (file) {
              appDispatch({
                type: "select-file",
                index: state.fileCursor,
                path: file.path,
              });
            }
          }
          break;
        case "toggle-pick": {
          if (panel !== "commits") {
            break;
          }
          const commit = commits[state.commitCursor];
          appDispatch({
            type: "toggle-pick",
            commit,
            commits,
            mode: "net",
          });
          break;
        }
        case "range-pick": {
          if (panel !== "commits") {
            break;
          }
          const commit = commits[state.commitCursor];
          appDispatch({
            type: "range-pick",
            index: state.commitCursor,
            commit,
          });
          break;
        }
        case "toggle-mode":
          appDispatch({ type: "toggle-mode" });
          break;
        case "time-windows":
          appDispatch({
            type: "open-time-windows",
            today: localDateInputValue(new Date()),
          });
          break;
        case "cycle-agent-filter":
          appDispatch({
            type: "cycle-agent-filter",
            agents: agentNames,
            allCommits,
          });
          break;
        case "time-window-close":
          appDispatch({ type: "close-time-window" });
          break;
        case "filters":
          appDispatch({ type: "filters-open" });
          break;
        case "filters-close":
          appDispatch({ type: "filters-close" });
          break;
        case "toggle-noise":
          markPreserve();
          appDispatch({ type: "toggle-noise" });
          break;
        case "toggle-mark": {
          const file =
            panel === "diff"
              ? files.find((candidate) => candidate.path === state.selectedPath)
              : (files[state.fileCursor] ??
                files.find(
                  (candidate) => candidate.path === state.selectedPath,
                ));
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
        case "expand-diff": {
          const file =
            panel === "diff"
              ? files.find((candidate) => candidate.path === state.selectedPath)
              : (files[state.fileCursor] ??
                files.find(
                  (candidate) => candidate.path === state.selectedPath,
                ));
          if (!file || !file.collapsed) {
            break;
          }

          const rev = file.newRev ?? file.oldRev;
          setDiffError(null);
          void fetchFileDiff(fileContext, file.path, rev)
            .then((updated) => {
              setChangeSet((current) =>
                current
                  ? replaceChangeFile(current, file.path, rev, updated)
                  : current,
              );
              setDiffError(null);
            })
            .catch((reason: unknown) => {
              setDiffError(
                reason instanceof Error ? reason.message : String(reason),
              );
            });
          break;
        }
        case "refresh":
          markPreserve();
          refreshRepository();
          break;
        case "toggle-diff-view":
          appDispatch({ type: "toggle-diff-view" });
          break;
        case "toggle-full-file":
          appDispatch({ type: "toggle-full-file" });
          break;
        case "cycle-theme":
          storeTheme(nextTheme(state.theme));
          appDispatch({ type: "cycle-theme" });
          break;
        case "jump-hunk": {
          const target = nextHunkTarget(
            searchFiles,
            state.diffView,
            currentHunkLocation(),
            action.direction,
          );
          if (target) {
            jumpToTarget(target.fileKey, target.row);
          }
          break;
        }
        case "jump-file": {
          const target = nextFileTarget(
            searchFiles,
            currentDiffFileKey(),
            action.direction,
          );
          if (target) {
            jumpToTarget(target.fileKey, target.row);
          }
          break;
        }
        case "search-open":
          appDispatch({ type: "search-open" });
          break;
        case "search-next":
          if (searchMatches.length > 0) {
            jumpToMatch(
              stepMatchIndex(
                searchMatches.length,
                state.matchIndex,
                action.direction,
              ),
            );
          }
          break;
        case "search-clear":
          clearSearch();
          break;
        case "scroll":
          diffRef.current?.scrollBy({ top: action.direction * 96 });
          break;
        case "help":
          appDispatch({ type: "help-open" });
          break;
        case "close-help":
          appDispatch({ type: "help-close" });
          break;
      }
    },
    [
      agentNames,
      allCommits,
      appDispatch,
      baseBranch,
      branches.length,
      clearSearch,
      commits,
      currentDiffFileKey,
      currentHunkLocation,
      diffRef,
      fileContext,
      files,
      jumpToMatch,
      jumpToTarget,
      markPreserve,
      refreshRepository,
      searchFiles,
      searchMatches,
      setChangeSet,
      setDiffError,
      setMarkError,
      setSelectedWorktreePath,
      state,
      worktrees,
    ],
  );

  const closeTimeWindow = useCallback(() => {
    appDispatch({ type: "close-time-window" });
  }, [appDispatch]);

  const runToolbarAction = useCallback(
    (item: ToolbarItem) => {
      dispatch(item.action, item.panelAction ?? undefined);
    },
    [dispatch],
  );

  return {
    dispatch,
    dispatchTimeWindow,
    chooseTimeWindowOption,
    applyCustomTimeWindow,
    applyFilterDraft,
    closeTimeWindow,
    runToolbarAction,
  };
}
