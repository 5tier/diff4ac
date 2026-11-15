import { useEffect, useRef } from "react";
import {
  bindingFor,
  bindingForFilters,
  bindingForSearch,
  bindingForTimeWindow,
  type KeyAction,
  type KeyBinding,
  type PanelId,
} from "../../shared/keymap";

export interface UseKeyboardParams {
  readonly keymap: readonly KeyBinding[];
  readonly dispatch: (action: KeyAction, panel?: PanelId) => void;
  readonly dispatchTimeWindow: (action: KeyAction) => void;
  readonly clearSearch: () => void;
  readonly commitSearch: () => void;
  readonly focusedPanel: PanelId;
  readonly helpOpen: boolean;
  readonly timeWindowOpen: boolean;
  readonly timeWindowDialogMode: "list" | "custom";
  readonly filtersOpen: boolean;
  readonly searchOpen: boolean;
  readonly searchActive: boolean;
  readonly enabled?: boolean;
}

export function useKeyboard(params: UseKeyboardParams): void {
  const latest = useRef(params);
  latest.current = params;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const {
        keymap,
        dispatch,
        dispatchTimeWindow,
        clearSearch,
        commitSearch,
        focusedPanel,
        helpOpen,
        timeWindowOpen,
        timeWindowDialogMode,
        filtersOpen,
        searchOpen,
        searchActive,
        enabled: isEnabled,
      } = latest.current;
      if (!isEnabled) {
        return;
      }

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

      if (searchOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          clearSearch();
        } else if (event.key === "Enter") {
          event.preventDefault();
          commitSearch();
        }
        return;
      }

      if (searchActive) {
        const searchBinding = bindingForSearch(keymap, event.key);
        if (searchBinding) {
          event.preventDefault();
          dispatch(searchBinding.action);
          return;
        }
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
  }, []);
}
