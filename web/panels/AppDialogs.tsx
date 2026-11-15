import type { Dispatch } from "react";
import type { KeyBinding } from "../../shared/keymap";
import type { CommitSummary } from "../../shared/types";
import type { AppAction, AppState } from "../state/app-state";
import type { ActionDispatcher } from "../hooks/useActions";
import { FiltersDialog } from "../FiltersDialog";
import { HelpOverlay } from "./HelpOverlay";
import { TimeWindowDialog } from "./TimeWindowDialog";

export function AppDialogs({
  state,
  appDispatch,
  keymap,
  noisePatterns,
  availableExtensions,
  commits,
  hasMoreCommits,
  actions,
}: {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly keymap: readonly KeyBinding[];
  readonly noisePatterns: readonly string[];
  readonly availableExtensions: readonly string[];
  readonly commits: readonly CommitSummary[];
  readonly hasMoreCommits: boolean;
  readonly actions: ActionDispatcher;
}) {
  const {
    helpOpen,
    focusedPanel,
    timeWindowOpen,
    timeWindowCursor,
    timeWindowDialogMode,
    timeWindowError,
    timeWindowStart,
    timeWindowEnd,
    filtersOpen,
    disabledExtensions,
    includeGlobs,
    excludeGlobs,
    hideNoise,
  } = state;

  return (
    <>
      {helpOpen ? (
        <HelpOverlay
          panel={focusedPanel}
          keymap={keymap}
          onClose={() => appDispatch({ type: "help-close" })}
        />
      ) : null}

      {timeWindowOpen ? (
        <TimeWindowDialog
          cursor={timeWindowCursor}
          mode={timeWindowDialogMode}
          error={timeWindowError}
          customStart={timeWindowStart}
          customEnd={timeWindowEnd}
          commits={commits}
          hasMore={hasMoreCommits}
          onChooseOption={actions.chooseTimeWindowOption}
          onCustomStartChange={(value) =>
            appDispatch({ type: "time-window-start", value })
          }
          onCustomEndChange={(value) =>
            appDispatch({ type: "time-window-end", value })
          }
          onApplyCustom={actions.applyCustomTimeWindow}
          onBack={() => appDispatch({ type: "time-window-back" })}
          onClose={actions.closeTimeWindow}
        />
      ) : null}

      {filtersOpen ? (
        <FiltersDialog
          availableExtensions={availableExtensions}
          noisePatterns={noisePatterns}
          initial={{
            disabledExtensions,
            includeGlobs,
            excludeGlobs,
            hideNoise,
          }}
          onApply={actions.applyFilterDraft}
          onClose={() => appDispatch({ type: "filters-close" })}
        />
      ) : null}
    </>
  );
}
