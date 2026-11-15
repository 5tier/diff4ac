import { useCallback } from "react";
import { localDateInputValue } from "../../shared/time-windows";
import { fetchFileDiff, setReviewMark } from "../api";
import type { KeyAction, PanelId } from "../../shared/keymap";
import type { ToolbarItem } from "../../shared/toolbar";
import { nextTheme, storeTheme } from "../theme";
import { stepMatchIndex } from "../../shared/diff/search";
import {
  nextFileTarget,
  nextHunkTarget,
} from "../../shared/diff/navigation";
import { useDialogActions } from "./useDialogActions";
import {
  replaceChangeFile,
  setChangeFileReviewState,
} from "../state/selection";
import { topNewLineForDiff } from "../state/code-view";
import {
  activeFileForAction,
  filesViewToggleActions,
  treeCollapseAction,
  treeExpandAction,
  treeJumpFilePlan,
  treeSelectAction,
} from "../state/file-tree";

import type { ActionDispatcher, UseActionsParams } from "./action-types";

export type { ActionDispatcher, UseActionsParams } from "./action-types";

export function useActions({
  state,
  appDispatch,
  files,
  fileTreeModel,
  fileContext,
  setChangeSet,
  setDiffError,
  setMarkError,
  commits,
  allCommits,
  hasMoreCommits,
  loadMoreCommits,
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
  const {
    dispatchTimeWindow,
    chooseTimeWindowOption,
    applyCustomTimeWindow,
    applyFilterDraft,
    closeTimeWindow,
  } = useDialogActions({
    appDispatch,
    commits,
    timeWindowCursor: state.timeWindowCursor,
    timeWindowStart: state.timeWindowStart,
    timeWindowEnd: state.timeWindowEnd,
    markPreserve,
  });

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
            if (
              action.direction > 0 &&
              commits.length > 0 &&
              hasMoreCommits &&
              state.commitCursor >= commits.length - 2
            ) {
              loadMoreCommits();
            }
          } else if (panel === "files") {
            appDispatch({
              type: "move",
              panel: "files",
              direction: action.direction,
              count:
                state.filesView === "tree"
                  ? fileTreeModel.rows.length
                  : files.length,
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
            const treeAction = treeSelectAction(
              state.filesView,
              state.fileCursor,
              fileTreeModel,
            );
            if (treeAction) {
              appDispatch(treeAction);
            } else {
              const file = files[state.fileCursor];
              if (file) {
                appDispatch({
                  type: "select-file",
                  index: state.fileCursor,
                  path: file.path,
                });
              }
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
        case "toggle-files-view": {
          for (const action of filesViewToggleActions(
            state.filesView,
            state.fileCursor,
            state.selectedPath,
            fileTreeModel,
          )) {
            appDispatch(action);
          }
          break;
        }
        case "expand": {
          const action = treeExpandAction(
            state.filesView,
            state.fileCursor,
            fileTreeModel,
          );
          if (action) {
            appDispatch(action);
          }
          break;
        }
        case "collapse": {
          const action = treeCollapseAction(
            state.filesView,
            state.fileCursor,
            fileTreeModel,
          );
          if (action) {
            appDispatch(action);
          }
          break;
        }
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
          const file = activeFileForAction(
            panel,
            files,
            state.filesView,
            state.fileCursor,
            state.selectedPath,
            fileTreeModel,
          );
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
          const file = activeFileForAction(
            panel,
            files,
            state.filesView,
            state.fileCursor,
            state.selectedPath,
            fileTreeModel,
          );
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
        case "code-view-side":
          if (state.codeView) {
            appDispatch({
              type: "code-view-side",
              side: state.codeViewSide === "after" ? "before" : "after",
            });
          }
          break;
        case "toggle-code-view": {
          if (state.codeView) {
            appDispatch({ type: "toggle-code-view" });
            break;
          }
          const file = files.find(
            (candidate) => candidate.path === state.selectedPath,
          );
          appDispatch({
            type: "toggle-code-view",
            path: file?.path ?? null,
            line: file
              ? topNewLineForDiff(diffRef.current, file, state.diffView)
              : 1,
          });
          break;
        }
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
          if (state.filesView === "tree") {
            const plan = treeJumpFilePlan(
              fileTreeModel,
              searchFiles,
              currentDiffFileKey(),
              action.direction,
            );
            if (plan) {
              for (const treeAction of plan.actions) {
                appDispatch(treeAction);
              }
              jumpToTarget(
                plan.target.fileKey,
                plan.target.row,
                plan.fileCursor,
              );
            }
            break;
          }

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
      fileTreeModel,
      files,
      hasMoreCommits,
      jumpToMatch,
      jumpToTarget,
      loadMoreCommits,
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
