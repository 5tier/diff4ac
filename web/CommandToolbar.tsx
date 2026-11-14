import type { ToolbarGroup, ToolbarItem } from "../src/toolbar";

interface CommandToolbarProps {
  readonly groups: readonly ToolbarGroup[];
  readonly onAction: (item: ToolbarItem) => void;
}

function itemTitle(item: ToolbarItem): string {
  if (!item.enabled) {
    return item.disabledReason ?? "Unavailable";
  }

  const action = item.value ? `${item.label}: ${item.value}` : item.label;
  return `${action} (${item.displayKey})`;
}

function itemName(item: ToolbarItem): string {
  const action = item.value ? `${item.label}: ${item.value}` : item.label;
  return `${action} (${item.displayKey})`;
}

export function CommandToolbar({ groups, onAction }: CommandToolbarProps) {
  return (
    <nav
      className="command-toolbar"
      aria-label="Command toolbar"
      data-testid="command-toolbar"
    >
      {groups.map((group) => (
        <div
          className="toolbar-group"
          key={group.id}
          role="group"
          aria-label={group.label}
          data-group={group.id}
        >
          <span className="toolbar-group-label" aria-hidden="true">
            {group.label}
          </span>
          <div className="toolbar-buttons">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="toolbar-button"
                data-binding-id={item.id}
                data-action={item.action.type}
                data-highlighted={item.highlighted ? "true" : undefined}
                aria-label={itemName(item)}
                aria-pressed={item.toggle ? item.pressed : undefined}
                disabled={!item.enabled}
                title={itemTitle(item)}
                onClick={(event) => {
                  event.currentTarget.blur();
                  onAction(item);
                }}
              >
                <span className="toolbar-label">{item.label}</span>
                {item.value ? (
                  <span className="toolbar-value">{item.value}</span>
                ) : null}
                <kbd className="toolbar-key">{item.displayKey}</kbd>
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
