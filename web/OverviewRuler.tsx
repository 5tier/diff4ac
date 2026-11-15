import { useEffect, useState, type RefObject } from "react";
import type { ChangeOverview, OverviewMark } from "../shared/diff/overview";
import {
  offsetForRow,
  type LayoutFile,
  type PaneLayout,
} from "../shared/diff/layout";
import { useDiffLayout } from "./diff-layout";

interface Viewport {
  readonly top: number;
  readonly height: number;
}

function percent(value: number, total: number): string {
  return total > 0 ? `${(value / total) * 100}%` : "0%";
}

function markTitle(mark: OverviewMark): string {
  const lines = `${mark.rowCount} changed ${mark.rowCount === 1 ? "line" : "lines"}`;
  return `${mark.kind === "mixed" ? "Changed" : mark.kind === "add" ? "Added" : "Deleted"} · ${lines}`;
}

function markFile(
  layout: PaneLayout | null,
  mark: OverviewMark,
): LayoutFile | null {
  return layout?.files.get(mark.fileKey) ?? null;
}

export function OverviewRuler({
  overview,
  pane,
}: {
  readonly overview: ChangeOverview;
  readonly pane: RefObject<HTMLElement | null>;
}) {
  const layout = useDiffLayout(pane, overview);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 1 });
  const scrollHeight = layout?.scrollHeight ?? 0;

  useEffect(() => {
    const element = pane.current;
    if (!element) {
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const height = element.scrollHeight;
      if (height <= 0) {
        return;
      }
      const next = {
        top: element.scrollTop / height,
        height: element.clientHeight / height,
      };
      setViewport((current) =>
        current.top === next.top && current.height === next.height
          ? current
          : next,
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };

    update();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      element.removeEventListener("scroll", schedule);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [pane]);

  const scrollToOffset = (offset: number, stickyHeight = 0) => {
    const element = pane.current;
    if (!element) {
      return;
    }
    const max = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTo({
      top: Math.min(max, Math.max(0, offset - stickyHeight)),
    });
  };

  const scrollToPosition = (clientY: number, ruler: HTMLElement) => {
    const element = pane.current;
    if (!element) {
      return;
    }
    const rect = ruler.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }
    const fraction = Math.min(
      1,
      Math.max(0, (clientY - rect.top) / rect.height),
    );
    const max = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTo({ top: fraction * max });
  };

  return (
    <div
      className="overview-ruler"
      data-testid="overview-ruler"
      aria-hidden="true"
      onPointerDown={(event) =>
        scrollToPosition(event.clientY, event.currentTarget)
      }
    >
      {layout
        ? overview.boundaries.map((boundary) => {
            const file = layout.files.get(boundary.fileKey);
            if (!file) {
              return null;
            }
            const offset = offsetForRow(file, boundary.row - file.rowStart);
            return (
              <div
                key={`boundary-${boundary.fileKey}`}
                className="overview-boundary"
                data-testid="overview-boundary"
                data-file-key={boundary.fileKey}
                style={{ top: percent(offset, scrollHeight) }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  scrollToOffset(offset, layout.stickyHeight);
                }}
              />
            );
          })
        : null}
      {layout
        ? overview.marks.map((mark, index) => {
            const file = markFile(layout, mark);
            if (!file) {
              return null;
            }
            const offset = offsetForRow(file, mark.startRow - file.rowStart);
            const height = Math.max(
              file.rowHeight,
              mark.rowCount * file.rowHeight,
            );
            return (
              <div
                key={`mark-${mark.fileKey}-${mark.startRow}-${index}`}
                className={`overview-mark overview-mark-${mark.kind}`}
                data-testid="overview-mark"
                data-kind={mark.kind}
                data-file-key={mark.fileKey}
                data-row={mark.startRow - file.rowStart}
                title={markTitle(mark)}
                style={{
                  top: percent(offset, scrollHeight),
                  height: percent(height, scrollHeight),
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  scrollToOffset(offset, layout.stickyHeight);
                }}
              />
            );
          })
        : null}
      <div
        className="overview-viewport"
        data-testid="overview-viewport"
        style={{
          top: `${viewport.top * 100}%`,
          height: `${viewport.height * 100}%`,
        }}
      />
    </div>
  );
}
