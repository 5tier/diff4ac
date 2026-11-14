import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

interface FadeState {
  readonly start: boolean;
  readonly end: boolean;
}

export function CommandToolbar({ groups, onAction }: CommandToolbarProps) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const labelledWidthRef = useRef(0);
  const [compact, setCompact] = useState(false);
  const [fades, setFades] = useState<FadeState>({ start: false, end: false });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const evaluate = () => {
      const available = element.clientWidth;

      if (compact) {
        const labelledWidth = labelledWidthRef.current;
        if (labelledWidth > 0 && labelledWidth <= available) {
          setCompact(false);
        }
        return;
      }

      const labelledWidth = element.scrollWidth;
      labelledWidthRef.current = labelledWidth;
      if (labelledWidth > available) {
        setCompact(true);
      }
    };

    evaluate();

    const observer = new ResizeObserver(() => evaluate());
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, groups]);

  const updateFades = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const remaining = element.scrollWidth - element.clientWidth;
    const start = element.scrollLeft > 1;
    const end = remaining - element.scrollLeft > 1;

    setFades((current) =>
      current.start === start && current.end === end
        ? current
        : { start, end },
    );
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const handleScroll = () => updateFades();
    element.addEventListener("scroll", handleScroll, { passive: true });

    const observer = new ResizeObserver(() => updateFades());
    observer.observe(element);

    updateFades();

    return () => {
      element.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [updateFades]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      const before = element.scrollLeft;
      element.scrollLeft += event.deltaY;
      if (element.scrollLeft !== before) {
        event.preventDefault();
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    updateFades();
  }, [compact, groups, updateFades]);

  return (
    <div
      className="command-toolbar-wrap"
      data-compact={compact ? "true" : undefined}
      data-fade-start={fades.start ? "true" : undefined}
      data-fade-end={fades.end ? "true" : undefined}
    >
      <nav
        ref={scrollRef}
        className="command-toolbar"
        aria-label="Command toolbar"
        data-testid="command-toolbar"
      >
        {groups.map((group, index) => (
          <div
            className="toolbar-group"
            key={group.id}
            role="group"
            aria-label={group.label}
            title={group.label}
            data-group={group.id}
            data-divider={index > 0 ? "true" : undefined}
          >
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
    </div>
  );
}
