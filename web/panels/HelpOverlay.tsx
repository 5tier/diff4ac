import {
  bindingsForPanel,
  PANEL_LABELS,
  type KeyBinding,
  type PanelId,
} from "../../shared/keymap";

export function HelpOverlay({
  panel,
  keymap,
  onClose,
}: {
  readonly panel: PanelId;
  readonly keymap: readonly KeyBinding[];
  readonly onClose: () => void;
}) {
  const bindings = bindingsForPanel(keymap, panel);
  const searchBindings = keymap.filter(
    (binding) => binding.panel === "search",
  );

  const renderBindings = (entries: readonly KeyBinding[]) => (
    <ul className="help-list">
      {entries.map((binding) => (
        <li
          className="help-row"
          key={`${binding.panel}:${binding.key}`}
          title={binding.id}
        >
          <kbd className="help-key">
            {binding.key === " " ? "Space" : binding.key}
          </kbd>
          <span className="help-label">{binding.label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Keybindings for ${PANEL_LABELS[panel]}`}
      data-testid="help-overlay"
      onClick={onClose}
    >
      <div className="help-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="help-header">
          <span>Keybindings · {PANEL_LABELS[panel]}</span>
          <button type="button" className="help-close" onClick={onClose}>
            Close
          </button>
        </header>

        {bindings.panel.length > 0 ? (
          <section className="help-section">
            <h2>{PANEL_LABELS[panel]}</h2>
            {renderBindings(bindings.panel)}
          </section>
        ) : null}

        <section className="help-section">
          <h2>Search</h2>
          <p className="help-note">
            Active while a search is set. Otherwise <kbd>n</kbd> toggles Noise.
          </p>
          {renderBindings(searchBindings)}
        </section>

        <section className="help-section">
          <h2>Global</h2>
          {renderBindings(bindings.global)}
        </section>
      </div>
    </div>
  );
}
