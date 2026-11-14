import { useState } from "react";

export interface FiltersDraft {
  readonly disabledExtensions: readonly string[];
  readonly includeGlobs: string;
  readonly excludeGlobs: string;
  readonly hideNoise: boolean;
}

interface FiltersDialogProps {
  readonly availableExtensions: readonly string[];
  readonly noisePatterns: readonly string[];
  readonly initial: FiltersDraft;
  readonly onApply: (draft: FiltersDraft) => void;
  readonly onClose: () => void;
}

function extensionLabel(extension: string): string {
  return extension === "" ? "(no extension)" : extension;
}

export function FiltersDialog({
  availableExtensions,
  noisePatterns,
  initial,
  onApply,
  onClose,
}: FiltersDialogProps) {
  const [disabledExtensions, setDisabledExtensions] = useState<
    readonly string[]
  >(initial.disabledExtensions);
  const [includeGlobs, setIncludeGlobs] = useState(initial.includeGlobs);
  const [excludeGlobs, setExcludeGlobs] = useState(initial.excludeGlobs);
  const [hideNoise, setHideNoise] = useState(initial.hideNoise);

  const toggleExtension = (extension: string) => {
    setDisabledExtensions((current) =>
      current.includes(extension)
        ? current.filter((value) => value !== extension)
        : [...current, extension],
    );
  };

  return (
    <div
      className="filters-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
      data-testid="filters-dialog"
      onClick={onClose}
    >
      <form
        className="filters-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onApply({
            disabledExtensions,
            includeGlobs,
            excludeGlobs,
            hideNoise,
          });
        }}
      >
        <header className="filters-header">
          <span>Filters</span>
          <button type="button" className="filters-close" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="filters-section">
          <h2>Extensions</h2>
          {availableExtensions.length === 0 ? (
            <div className="placeholder">No extensions in this Change Set.</div>
          ) : (
            <ul className="filters-extension-list">
              {availableExtensions.map((extension) => (
                <li key={extension || "(none)"}>
                  <label className="filters-extension">
                    <input
                      type="checkbox"
                      data-extension={extension}
                      checked={!disabledExtensions.includes(extension)}
                      onChange={() => toggleExtension(extension)}
                    />
                    <span>{extensionLabel(extension)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="filters-section">
          <p className="filters-hint">
            Globs without / match basenames at any depth; with / match repo
            paths (/ anchors at root).
          </p>
          <label className="filters-field">
            <span>Include globs (one per line)</span>
            <textarea
              rows={2}
              value={includeGlobs}
              placeholder="src/**"
              data-filter="include"
              onChange={(event) => setIncludeGlobs(event.target.value)}
            />
          </label>
          <label className="filters-field">
            <span>Exclude globs (one per line)</span>
            <textarea
              rows={2}
              value={excludeGlobs}
              placeholder="**/*.generated.ts"
              data-filter="exclude"
              onChange={(event) => setExcludeGlobs(event.target.value)}
            />
          </label>
          <label className="filters-noise">
            <input
              type="checkbox"
              data-filter="noise"
              checked={hideNoise}
              onChange={(event) => setHideNoise(event.target.checked)}
            />
            <span>Hide Noise files</span>
          </label>
        </section>

        <section className="filters-section">
          <h2>Effective Noise patterns</h2>
          {noisePatterns.length === 0 ? (
            <div className="placeholder">No Noise patterns configured.</div>
          ) : (
            <ul className="filters-noise-patterns">
              {noisePatterns.map((pattern) => (
                <li key={pattern}>
                  <code>{pattern}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="filters-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Apply</button>
        </footer>
      </form>
    </div>
  );
}
