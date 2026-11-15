import { useEffect, useRef } from "react";
import type { ChangeEvent, Dispatch } from "react";
import type { SnapshotPathMatch } from "../../shared/types";
import type { KeyBinding } from "../../shared/keymap";
import type { AppAction, AppState } from "../state/app-state";
import { statusLabel } from "../state/code-view";
import { displayKey } from "../../shared/toolbar";

interface FinderDialogProps {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly results: readonly SnapshotPathMatch[];
  readonly loading: boolean;
  readonly onChoose: (path: string) => void;
}

export function FinderDialog({
  state,
  appDispatch,
  results,
  loading,
  onChoose,
}: FinderDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="code-finder-overlay"
      data-testid="code-finder"
      onClick={() => appDispatch({ type: "code-view-finder-close" })}
    >
      <div
        className="code-finder"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="code-finder-input"
          value={state.codeViewFinderQuery}
          aria-label="Find file in Snapshot"
          placeholder="Go to file…"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            appDispatch({
              type: "code-view-finder-query",
              value: event.target.value,
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              appDispatch({ type: "code-view-finder-close" });
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next =
                state.codeViewFinderIndex +
                (event.key === "ArrowDown" ? 1 : -1);
              appDispatch({
                type: "code-view-finder-index",
                index: Math.max(0, next),
              });
            } else if (event.key === "Enter") {
              event.preventDefault();
              const match = results[state.codeViewFinderIndex];
              if (match) {
                onChoose(match.path);
              }
            }
          }}
        />
        <ul className="code-finder-results">
          {loading ? <li className="muted">Searching…</li> : null}
          {results.map((match, index) => (
            <li key={match.path}>
              <button
                type="button"
                className={
                  index === state.codeViewFinderIndex
                    ? "code-finder-row code-finder-row-cursor"
                    : "code-finder-row"
                }
                onClick={() => onChoose(match.path)}
              >
                {match.status ? (
                  <span className="code-status">
                    {statusLabel(match.status)}
                  </span>
                ) : null}
                <span>{match.path}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CodeHelp({
  keymap,
  onClose,
}: {
  readonly keymap: readonly KeyBinding[];
  readonly onClose: () => void;
}) {
  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keybindings for Code View"
      data-testid="code-help"
      onClick={onClose}
    >
      <div className="help-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="help-header">
          <span>Keybindings · Code View</span>
          <button type="button" className="help-close" onClick={onClose}>
            Close
          </button>
        </header>
        <section className="help-section">
          <h2>Code View</h2>
          <ul className="help-list">
            {keymap
              .filter(
                (binding) =>
                  binding.panel === "code-view" ||
                  binding.id === "global.toggleCodeView" ||
                  binding.id === "global.refresh",
              )
              .map((binding) => (
                <li className="help-row" key={binding.id}>
                  <kbd className="help-key">{displayKey(binding.key)}</kbd>
                  <span className="help-label">{binding.label}</span>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
