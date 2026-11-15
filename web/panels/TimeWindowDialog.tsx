import { TIME_WINDOW_OPTIONS } from "../../src/time-windows";

export interface TimeWindowDialogProps {
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

export function TimeWindowDialog({
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
