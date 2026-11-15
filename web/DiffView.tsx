import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { ChangeFile } from "../shared/types";
import type { FileRequestContext } from "./api";
import {
  buildDiffRows,
  highlightSegments,
  type DiffRow,
  type DiffViewMode,
  type HighlightRange,
  type SplitCell,
  type TokenSpan,
} from "../shared/diff/rows";
import {
  groupMatchesByRow,
  type SearchMatch,
  type RowSearchMatches,
} from "../shared/diff/search";
import {
  describeModeChange,
  isModeOnlyChange,
  modeChangeFor,
} from "../shared/diff/mode";
import { useHunkHighlights } from "./useHunkHighlights";
import { measureDiffLayout } from "./diff-layout";
import { binarySummary, ImagePreview } from "./panels/FilePreview";
import { offsetForRow } from "../shared/diff/layout";

export const ROW_HEIGHT = 20;
export const VIRTUAL_ROW_THRESHOLD = 300;
const OVERSCAN = 8;

export interface DiffJump {
  readonly fileKey: string;
  readonly row: number;
  readonly nonce: number;
}

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
  search,
  tone,
  prefix,
}: {
  readonly content: string;
  readonly tokens: readonly TokenSpan[] | null;
  readonly word: readonly { readonly start: number; readonly end: number }[] | null;
  readonly search: readonly HighlightRange[] | null;
  readonly tone: "add" | "delete" | "context";
  readonly prefix?: string;
}) {
  const segments = highlightSegments(content, tokens, word, search);
  const wordClass =
    tone === "delete" ? "diff-word diff-word-removed" : tone === "add" ? "diff-word diff-word-added" : "diff-word";

  return (
    <>
      {prefix !== undefined ? (
        <span className={`diff-sign diff-sign-${tone}`}>{prefix}</span>
      ) : null}
      {segments.map((segment, index) => {
        const classes = [
          "diff-token",
          segment.word ? wordClass : "",
          segment.search ? "diff-search-match" : "",
          segment.current ? "diff-search-current" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <span key={index} className={classes} style={tokenStyle(segment)}>
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

function searchRanges(
  matches: readonly SearchMatch[] | undefined,
  current: SearchMatch | null,
): HighlightRange[] {
  return (matches ?? []).map((match) => ({
    start: match.start,
    end: match.end,
    current: match === current,
  }));
}

function SplitCellView({
  cell,
  matches,
  currentMatch,
}: {
  readonly cell: SplitCell;
  readonly matches?: readonly SearchMatch[];
  readonly currentMatch: SearchMatch | null;
}) {
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
          search={searchRanges(matches, currentMatch)}
          tone={tone}
        />
      </span>
    </div>
  );
}

function RowView({
  row,
  rowIndex,
  matches,
  currentMatch,
}: {
  readonly row: DiffRow;
  readonly rowIndex: number;
  readonly matches?: RowSearchMatches;
  readonly currentMatch: SearchMatch | null;
}) {
  if (row.kind === "hunk") {
    return (
      <div className="diff-line diff-hunk" data-diff-row={rowIndex}>
        {row.header}
      </div>
    );
  }

  if (row.kind === "line") {
    const prefix = row.type === "add" ? "+" : row.type === "delete" ? "-" : " ";
    const tone =
      row.type === "delete" ? "delete" : row.type === "add" ? "add" : "context";
    return (
      <div
        className={`diff-line diff-${row.type}`}
        data-diff-row={rowIndex}
      >
        <HighlightedContent
          content={row.content}
          tokens={row.tokens}
          word={row.word}
          search={searchRanges(matches?.line, currentMatch)}
          tone={tone}
          prefix={prefix}
        />
      </div>
    );
  }

  return (
    <div className="diff-line diff-split-row" data-diff-row={rowIndex}>
      {row.left ? (
        <SplitCellView
          cell={row.left}
          matches={matches?.left}
          currentMatch={currentMatch}
        />
      ) : (
        <div className="diff-split-cell diff-split-empty" />
      )}
      {row.right ? (
        <SplitCellView
          cell={row.right}
          matches={matches?.right}
          currentMatch={currentMatch}
        />
      ) : (
        <div className="diff-split-cell diff-split-empty" />
      )}
    </div>
  );
}

export function DiffView({
  file,
  fileKey,
  id,
  context,
  viewMode,
  forceVirtual = false,
  searchMatches = [],
  currentMatch = null,
  jump = null,
}: {
  readonly file: ChangeFile;
  readonly fileKey: string;
  readonly id?: string;
  readonly context: FileRequestContext;
  readonly viewMode: DiffViewMode;
  readonly forceVirtual?: boolean;
  readonly searchMatches?: readonly SearchMatch[];
  readonly currentMatch?: SearchMatch | null;
  readonly jump?: DiffJump | null;
}) {
  const highlights = useHunkHighlights(file);
  const modeChange = modeChangeFor(file);
  const modeOnly = isModeOnlyChange(file);
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
  const rowMatches = useMemo(
    () => groupMatchesByRow(searchMatches),
    [searchMatches],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!jump || jump.fileKey !== fileKey) {
      return;
    }

    const root = rootRef.current;
    const pane = root?.closest(".diff-pane") as HTMLElement | null;
    if (!pane) {
      return;
    }

    const scrollToRow = () => {
      const layout = measureDiffLayout(pane);
      const file = layout.files.get(fileKey);
      if (!file) {
        return;
      }
      const top =
        offsetForRow(file, Math.max(0, jump.row)) - layout.stickyHeight;
      pane.scrollTo({ top: Math.max(0, top) });
    };

    scrollToRow();
    const frame = requestAnimationFrame(scrollToRow);
    return () => cancelAnimationFrame(frame);
  }, [fileKey, jump]);

  return (
    <div className="diff-view" id={id} ref={rootRef} data-file-key={fileKey}>
      <div
        className="diff-heading"
        data-layout-block="file-heading"
        data-file-key={fileKey}
      >
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

      {modeChange ? (
        <div
          className="diff-mode"
          data-testid="mode-change"
          data-layout-block="file-mode"
          data-file-key={fileKey}
        >
          {describeModeChange(modeChange)}
        </div>
      ) : null}

      {file.image ? (
        <ImagePreview file={file} fileKey={fileKey} context={context} />
      ) : null}

      {file.binary ? (
        <div
          className="diff-empty"
          data-layout-block="file-binary"
          data-file-key={fileKey}
        >
          {binarySummary(file)}
        </div>
      ) : file.collapsed ? (
        <div
          className="diff-empty diff-collapsed"
          data-testid="collapsed-diff"
          data-layout-block="file-collapsed"
          data-file-key={fileKey}
        >
          Large diff · {file.additions + file.deletions} changed lines. Press{" "}
          <kbd>x</kbd> to load it.
        </div>
      ) : modeOnly ? null : (
        <div
          ref={ref}
          className={
            virtualized ? "diff-lines diff-lines-virtual" : "diff-lines"
          }
          data-layout-rows="true"
          data-file-key={fileKey}
          data-row-height={ROW_HEIGHT}
          data-row-count={rows.length}
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
              {visibleRows.map((row, index) => (
                <RowView
                  key={row.key}
                  row={row}
                  rowIndex={range.start + index}
                  matches={rowMatches.get(range.start + index)}
                  currentMatch={currentMatch}
                />
              ))}
            </div>
          ) : (
            visibleRows.map((row, index) => (
              <RowView
                key={row.key}
                row={row}
                rowIndex={index}
                matches={rowMatches.get(index)}
                currentMatch={currentMatch}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
