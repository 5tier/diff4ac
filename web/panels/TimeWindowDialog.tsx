import {
  createCustomTimeWindow,
  createPresetTimeWindow,
  filterCommitsInTimeWindow,
  TIME_WINDOW_OPTIONS,
} from "../../shared/time-windows";
import type { CommitSummary, TimeWindow } from "../../shared/types";

export interface TimeWindowDialogProps {
  readonly cursor: number;
  readonly mode: "list" | "custom";
  readonly error: string | null;
  readonly customStart: string;
  readonly customEnd: string;
  readonly commits: readonly CommitSummary[];
  readonly hasMore: boolean;
  readonly onChooseOption: (index: number) => void;
  readonly onCustomStartChange: (value: string) => void;
  readonly onCustomEndChange: (value: string) => void;
  readonly onApplyCustom: () => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

export function TimeWindowDialog({
  cursor,
  mode,
  error,
  customStart,
  customEnd,
  commits,
  hasMore,
  onChooseOption,
  onCustomStartChange,
  onCustomEndChange,
  onApplyCustom,
  onBack,
  onClose,
}: TimeWindowDialogProps) {
  const oldestLoaded = commits.reduce((oldest, commit) => {
    const committedAt = Date.parse(commit.committedAt);
    return Number.isNaN(committedAt)
      ? oldest
      : Math.min(oldest, committedAt);
  }, Number.POSITIVE_INFINITY);

  let customWindow: TimeWindow | null = null;
  if (mode === "custom") {
    try {
      customWindow = createCustomTimeWindow(customStart, customEnd);
    } catch {
      customWindow = null;
    }
  }
  const customCount =
    customWindow === null
      ? null
      : filterCommitsInTimeWindow(commits, customWindow).length;
  const customApproximate =
    customWindow !== null &&
    hasMore &&
    commits.length > 0 &&
    Date.parse(customWindow.start) < oldestLoaded;

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
            {TIME_WINDOW_OPTIONS.map((option, index) => {
              const window =
                option.preset === "custom"
                  ? null
                  : createPresetTimeWindow(option.preset);
              const count = window
                ? filterCommitsInTimeWindow(commits, window).length
                : null;
              const approximate =
                window !== null &&
                hasMore &&
                commits.length > 0 &&
                Date.parse(window.start) < oldestLoaded;

              return (
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
                    {count !== null ? (
                      <span
                        className="time-window-option-count"
                        data-testid={`time-window-count-${option.preset}`}
                      >
                        {count}
                        {approximate ? "+" : ""} commit
                        {count === 1 && !approximate ? "" : "s"}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
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
            {customCount !== null ? (
              <div className="time-window-count" data-testid="time-window-custom-count">
                {customCount}
                {customApproximate ? "+" : ""} commit
                {customCount === 1 && !customApproximate ? "" : "s"}
              </div>
            ) : null}
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
