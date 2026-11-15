import { useCallback } from "react";
import type { Dispatch } from "react";
import type { CommitSummary } from "../../shared/types";
import {
  createCustomTimeWindow,
  createPresetTimeWindow,
  TIME_WINDOW_OPTIONS,
} from "../../shared/time-windows";
import type { KeyAction } from "../../shared/keymap";
import type { AppAction } from "../state/app-state";
import type { FiltersDraft } from "../FiltersDialog";

export interface UseDialogActionsParams {
  readonly appDispatch: Dispatch<AppAction>;
  readonly commits: readonly CommitSummary[];
  readonly timeWindowCursor: number;
  readonly timeWindowStart: string;
  readonly timeWindowEnd: string;
  readonly markPreserve: () => void;
}

export interface DialogActions {
  readonly dispatchTimeWindow: (action: KeyAction) => void;
  readonly chooseTimeWindowOption: (index: number) => void;
  readonly applyCustomTimeWindow: () => void;
  readonly applyFilterDraft: (draft: FiltersDraft) => void;
  readonly closeTimeWindow: () => void;
}

export function useDialogActions({
  appDispatch,
  commits,
  timeWindowCursor,
  timeWindowStart,
  timeWindowEnd,
  markPreserve,
}: UseDialogActionsParams): DialogActions {
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
        window: createCustomTimeWindow(timeWindowStart, timeWindowEnd),
        commits,
      });
    } catch (error) {
      appDispatch({
        type: "time-window-error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [appDispatch, commits, timeWindowEnd, timeWindowStart]);

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
          chooseTimeWindowOption(timeWindowCursor);
          break;
        case "time-window-close":
          appDispatch({ type: "close-time-window" });
          break;
      }
    },
    [appDispatch, chooseTimeWindowOption, timeWindowCursor],
  );

  const applyFilterDraft = useCallback(
    (draft: FiltersDraft) => {
      markPreserve();
      appDispatch({ type: "apply-filter-draft", draft });
    },
    [appDispatch, markPreserve],
  );

  const closeTimeWindow = useCallback(() => {
    appDispatch({ type: "close-time-window" });
  }, [appDispatch]);

  return {
    dispatchTimeWindow,
    chooseTimeWindowOption,
    applyCustomTimeWindow,
    applyFilterDraft,
    closeTimeWindow,
  };
}
