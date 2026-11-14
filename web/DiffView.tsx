import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ChangeFile } from "../src/types";
import { fileContentUrl, type FileRequestContext } from "./api";
import {
  buildDiffRows,
  wordDiffSegments,
  type DiffRow,
  type DiffViewMode,
  type SplitCell,
  type TokenSpan,
} from "../src/diff/rows";
import { useHunkHighlights } from "./useHunkHighlights";

const ROW_HEIGHT = 20;
export const VIRTUAL_ROW_THRESHOLD = 300;
const OVERSCAN = 8;

export function countDiffRows(files: readonly ChangeFile[]): number {
  return files.reduce(
    (total, file) =>
      total +
      file.hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0),
    0,
  );
}

interface VirtualRange {
  readonly start: number;
  readonly end: number;
}

function useVirtualRows(
  enabled: boolean,
  rowCount: number,
): {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly range: VirtualRange;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState<VirtualRange>(() => ({
    start: 0,
    end: enabled ? Math.min(rowCount, OVERSCAN * 2) : rowCount,
  }));

  useLayoutEffect(() => {
    if (!enabled) {
      setRange({ start: 0, end: rowCount });
      return;
    }

    const container = ref.current;
    const pane = container?.closest(".diff-pane") as HTMLElement | null;
    if (!container || !pane) {
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const containerRect = container.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const offset = containerRect.top - paneRect.top + pane.scrollTop;
      const viewTop = pane.scrollTop - offset;
      const viewBottom = viewTop + pane.clientHeight;
      const start = Math.max(
        0,
        Math.floor(viewTop / ROW_HEIGHT) - OVERSCAN,
      );
      const end = Math.min(
        rowCount,
        Math.ceil(viewBottom / ROW_HEIGHT) + OVERSCAN,
      );

      setRange((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };

    update();
    pane.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      pane.removeEventListener("scroll", schedule);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [enabled, rowCount]);

  return { ref, range };
}

function tokenStyle(
  token: { readonly style?: Readonly<Record<string, string>> } | undefined,
): CSSProperties | undefined {
  return token?.style as CSSProperties | undefined;
}

function HighlightedContent({
  content,
  tokens,
  word,
  tone,
  prefix,
}: {
  readonly content: string;
  readonly tokens: readonly TokenSpan[] | null;
  readonly word: readonly { readonly start: number; readonly end: number }[] | null;
  readonly tone: "add" | "delete" | "context";
  readonly prefix?: string;
}) {
  const segments = wordDiffSegments(content, tokens, word);
  const wordClass =
    tone === "delete" ? "diff-word diff-word-removed" : tone === "add" ? "diff-word diff-word-added" : "diff-word";

  return (
    <>
      {prefix !== undefined ? (
        <span className={`diff-sign diff-sign-${tone}`}>{prefix}</span>
      ) : null}
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <span
            key={index}
            className={`${wordClass} diff-token`}
            style={tokenStyle(segment)}
          >
            {segment.text}
          </span>
        ) : (
          <span key={index} className="diff-token" style={tokenStyle(segment)}>
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}

function SplitCellView({ cell }: { readonly cell: SplitCell }) {
  const tone =
    cell.type === "delete" ? "delete" : cell.type === "add" ? "add" : "context";
  return (
    <div className={`diff-split-cell diff-split-${tone}`}>
      <span className="diff-line-number">{cell.lineNumber ?? ""}</span>
      <span className="diff-content">
        <HighlightedContent
          content={cell.content}
          tokens={cell.tokens}
          word={cell.word}
          tone={tone}
        />
      </span>
    </div>
  );
}

function RowView({ row }: { readonly row: DiffRow }) {
  if (row.kind === "hunk") {
    return <div className="diff-line diff-hunk">{row.header}</div>;
  }

  if (row.kind === "line") {
    const prefix = row.type === "add" ? "+" : row.type === "delete" ? "-" : " ";
    const tone =
      row.type === "delete" ? "delete" : row.type === "add" ? "add" : "context";
    return (
      <div className={`diff-line diff-${row.type}`}>
        <HighlightedContent
          content={row.content}
          tokens={row.tokens}
          word={row.word}
          tone={tone}
          prefix={prefix}
        />
      </div>
    );
  }

  return (
    <div className="diff-line diff-split-row">
      {row.left ? (
        <SplitCellView cell={row.left} />
      ) : (
        <div className="diff-split-cell diff-split-empty" />
      )}
      {row.right ? (
        <SplitCellView cell={row.right} />
      ) : (
        <div className="diff-split-cell diff-split-empty" />
      )}
    </div>
  );
}

function formatBytes(size: number | undefined): string {
  if (size === undefined) {
    return "unknown size";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function binarySummary(file: ChangeFile): string {
  if (file.status === "added") {
    return `Binary file added · ${formatBytes(file.newSize)}`;
  }
  if (file.status === "deleted") {
    return `Binary file deleted · ${formatBytes(file.oldSize)}`;
  }
  return `Binary file changed · old ${formatBytes(
    file.oldSize,
  )} → new ${formatBytes(file.newSize)}`;
}

function ImagePreview({
  file,
  context,
}: {
  readonly file: ChangeFile;
  readonly context: FileRequestContext;
}) {
  const before = file.oldRev
    ? fileContentUrl(context, file.path, file.oldRev)
    : null;
  const after = file.newRev
    ? fileContentUrl(context, file.path, file.newRev)
    : null;

  if (!before && !after) {
    return null;
  }

  return (
    <div className="image-preview" data-testid="image-preview">
      {before ? (
        <figure className="image-preview-side">
          <figcaption>Before · {file.oldPath ?? file.path}</figcaption>
          <img
            src={before}
            alt={`${file.oldPath ?? file.path} before`}
            loading="lazy"
          />
        </figure>
      ) : null}
      {after ? (
        <figure className="image-preview-side">
          <figcaption>After · {file.path}</figcaption>
          <img src={after} alt={`${file.path} after`} loading="lazy" />
        </figure>
      ) : null}
    </div>
  );
}

export function DiffView({
  file,
  id,
  context,
  viewMode,
  forceVirtual = false,
}: {
  readonly file: ChangeFile;
  readonly id?: string;
  readonly context: FileRequestContext;
  readonly viewMode: DiffViewMode;
  readonly forceVirtual?: boolean;
}) {
  const highlights = useHunkHighlights(file);
  const rows = useMemo(
    () =>
      file.binary || file.collapsed
        ? []
        : buildDiffRows(file.hunks, viewMode, highlights),
    [file.binary, file.collapsed, file.hunks, highlights, viewMode],
  );
  const virtualized = forceVirtual || rows.length > VIRTUAL_ROW_THRESHOLD;
  const { ref, range } = useVirtualRows(virtualized, rows.length);
  const visibleRows = virtualized ? rows.slice(range.start, range.end) : rows;

  return (
    <div className="diff-view" id={id}>
      <div className="diff-heading">
        <span className="diff-heading-path">
          {file.oldPath ? (
            <>
              <span className="muted">{file.oldPath}</span>
              <span className="diff-arrow"> → </span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        <span className="file-counts">
          <span className="add">+{file.additions}</span>
          <span className="del">−{file.deletions}</span>
        </span>
      </div>

      {file.image ? <ImagePreview file={file} context={context} /> : null}

      {file.binary ? (
        <div className="diff-empty">{binarySummary(file)}</div>
      ) : file.collapsed ? (
        <div className="diff-empty diff-collapsed" data-testid="collapsed-diff">
          Large diff · {file.additions + file.deletions} changed lines. Press{" "}
          <kbd>x</kbd> to load it.
        </div>
      ) : (
        <div
          ref={ref}
          className={
            virtualized ? "diff-lines diff-lines-virtual" : "diff-lines"
          }
          style={
            virtualized
              ? { height: rows.length * ROW_HEIGHT, position: "relative" }
              : undefined
          }
        >
          {virtualized ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${range.start * ROW_HEIGHT}px)`,
              }}
            >
              {visibleRows.map((row) => (
                <RowView key={row.key} row={row} />
              ))}
            </div>
          ) : (
            visibleRows.map((row) => <RowView key={row.key} row={row} />)
          )}
        </div>
      )}
    </div>
  );
}
