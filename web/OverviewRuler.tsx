import { useEffect, useState, type RefObject } from "react";
import type { ChangeOverview, OverviewMark } from "../shared/diff/overview";

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

export function OverviewRuler({
  overview,
  pane,
}: {
  readonly overview: ChangeOverview;
  readonly pane: RefObject<HTMLElement | null>;
}) {
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 1 });

  useEffect(() => {
    const element = pane.current;
    if (!element) {
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollHeight = element.scrollHeight;
      if (scrollHeight <= 0) {
        return;
      }
      const next = {
        top: element.scrollTop / scrollHeight,
        height: element.clientHeight / scrollHeight,
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
      {overview.boundaries.map((boundary) => (
        <div
          key={`boundary-${boundary.fileKey}`}
          className="overview-boundary"
          data-testid="overview-boundary"
          style={{ top: percent(boundary.row, overview.rowCount) }}
        />
      ))}
      {overview.marks.map((mark, index) => (
        <div
          key={`mark-${mark.fileKey}-${mark.startRow}-${index}`}
          className={`overview-mark overview-mark-${mark.kind}`}
          data-testid="overview-mark"
          data-kind={mark.kind}
          title={markTitle(mark)}
          style={{
            top: percent(mark.startRow, overview.rowCount),
            height: percent(mark.rowCount, overview.rowCount),
          }}
        />
      ))}
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
