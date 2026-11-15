import type { ReactNode } from "react";
import type { PanelId } from "../../shared/keymap";

export interface PanelProps {
  readonly id: PanelId;
  readonly title: string;
  readonly count?: number;
  readonly grow?: boolean;
  readonly focused: boolean;
  readonly cursor?: number;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Panel({
  id,
  title,
  count,
  grow = false,
  focused,
  cursor,
  className,
  children,
}: PanelProps) {
  const classes = [
    "panel",
    grow ? "panel-grow" : "",
    focused ? "panel-focused" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={classes}
      data-panel={id}
      data-focused={focused ? "true" : "false"}
      data-cursor={cursor}
    >
      <header className="panel-title">
        <span>{title}</span>
        {count !== undefined ? <span className="panel-count">{count}</span> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
