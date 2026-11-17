import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type {
  ChangeFile,
  SnapshotFile,
  SnapshotSide,
} from "../../shared/types";
import type { FileRequestContext } from "../api";
import { isMarkdownPath } from "../markdown-html";
import { MarkdownPreview } from "./MarkdownPreview";
import type { ChangeOverview, OverviewMark } from "../../shared/diff/overview";
import { ROW_HEIGHT } from "../DiffView";
import {
  highlightSegments,
  type HighlightRange,
} from "../../shared/diff/rows";
import { OverviewRuler } from "../OverviewRuler";
import {
  CODE_HIGHLIGHT_LINE_LIMIT,
  codeLineCount,
  languageForPath,
  highlightLines,
} from "../highlight";
import {
  beforeChangeMarks,
  changeMarks,
  type LineRange,
} from "../../shared/diff/change-marks";
import {
  markSets,
  statusLabel,
  type CodeGap,
  type CodeSearchMatch,
} from "../state/code-view";

function markOverview(
  path: string,
  lineCount: number,
  added: readonly LineRange[],
  modified: readonly LineRange[],
  removed: readonly LineRange[],
  gaps: readonly CodeGap[],
): ChangeOverview {
  const entries: OverviewMark[] = [];
  for (const range of added) {
    entries.push({
      fileKey: path,
      startRow: Math.max(0, range.start - 1),
      rowCount: Math.max(1, range.end - range.start + 1),
      kind: "add",
    });
  }
  for (const range of modified) {
    entries.push({
      fileKey: path,
      startRow: Math.max(0, range.start - 1),
      rowCount: Math.max(1, range.end - range.start + 1),
      kind: "mixed",
    });
  }
  for (const range of removed) {
    entries.push({
      fileKey: path,
      startRow: Math.max(0, range.start - 1),
      rowCount: Math.max(1, range.end - range.start + 1),
      kind: "delete",
    });
  }
  for (const gap of gaps) {
    entries.push({
      fileKey: path,
      startRow: Math.max(0, gap.line - 1),
      rowCount: 1,
      kind: gap.kind === "add" ? "add" : "delete",
    });
  }
  return {
    rowCount: lineCount,
    marks: entries,
    boundaries: [{ fileKey: path, row: 0 }],
  };
}

function searchRangesForLine(
  matches: readonly CodeSearchMatch[],
  lineNumber: number,
  currentIndex: number,
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  matches.forEach((match, index) => {
    if (match.line === lineNumber) {
      ranges.push({
        start: match.start,
        end: match.end,
        current: index === currentIndex,
      });
    }
  });
  return ranges;
}

interface CodeHighlightState {
  readonly key: string;
  readonly lines: readonly (readonly {
    readonly content: string;
    readonly style?: Readonly<Record<string, string>>;
  }[])[] | null;
}

function textHash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

function useCodeTokens(path: string, text: string | undefined): CodeHighlightState | null {
  const key = `${path}\u0000${textHash(text ?? "")}:${text?.length ?? 0}`;
  const [state, setState] = useState<CodeHighlightState | null>(null);

  useEffect(() => {
    if (!text || codeLineCount(text) > CODE_HIGHLIGHT_LINE_LIMIT) {
      return;
    }
    let cancelled = false;
    highlightLines(text, languageForPath(path))
      .then((lines) => {
        if (!cancelled) {
          setState({ key, lines });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ key, lines: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, path, text]);

  return state?.key === key ? state : null;
}

export function CodePane({
  file,
  changeFile,
  side,
  path,
  loading,
  error,
  notice,
  rawUrl,
  searchMatches,
  searchIndex,
  initialLine,
  jumpLine,
  paneRef,
  preview,
  snapshotTarget,
  onShowCode,
  onShowPreview,
  onOpenFile,
  onLoadFull,
  onToggleMark,
  onLineChange,
}: {
  readonly file: SnapshotFile | null;
  readonly changeFile: ChangeFile | null;
  readonly side: SnapshotSide;
  readonly path: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly rawUrl: string | null;
  readonly searchMatches: readonly CodeSearchMatch[];
  readonly searchIndex: number;
  readonly initialLine: number;
  readonly jumpLine: { readonly line: number; readonly nonce: number } | null;
  readonly paneRef: RefObject<HTMLElement | null>;
  readonly preview: boolean;
  readonly snapshotTarget: FileRequestContext;
  readonly onShowCode: () => void;
  readonly onShowPreview: () => void;
  readonly onOpenFile: (path: string) => void;
  readonly onLoadFull: () => void;
  readonly onToggleMark: () => void;
  readonly onLineChange: (line: number) => void;
}) {
  const tokens = useCodeTokens(path ?? "", file?.text);
  const lines = useMemo(
    () => (file?.text === undefined ? [] : file.text.split("\n")),
    [file?.text],
  );
  const marks = useMemo(() => {
    if (!changeFile) {
      return null;
    }
    const path = file?.path ?? changeFile.path;
    if (side === "after") {
      const after = changeMarks(changeFile.hunks);
      const gaps = after.deletedAfter.map(
        (line): CodeGap => ({ line, kind: "delete" }),
      );
      return {
        sets: markSets(after.added, after.modified, [], gaps),
        overview: markOverview(
          path,
          lines.length,
          after.added,
          after.modified,
          [],
          gaps,
        ),
      };
    }
    const before = beforeChangeMarks(changeFile.hunks);
    const gaps = before.addedAfter.map(
      (line): CodeGap => ({ line, kind: "add" }),
    );
    return {
      sets: markSets([], before.modified, before.removed, gaps),
      overview: markOverview(
        path,
        lines.length,
        [],
        before.modified,
        before.removed,
        gaps,
      ),
    };
  }, [changeFile, file?.path, lines.length, side]);

  const scrollFrame = useRef(0);

  useEffect(() => {
    paneRef.current?.scrollTo({
      top: Math.max(0, initialLine - 2) * ROW_HEIGHT,
    });
  }, [file?.path, initialLine, paneRef, side]);

  useEffect(() => {
    if (!jumpLine) {
      return;
    }
    paneRef.current?.scrollTo({
      top: Math.max(0, jumpLine.line - 1) * ROW_HEIGHT,
    });
  }, [jumpLine, paneRef]);

  useEffect(() => {
    const match = searchMatches[searchIndex];
    if (!match) {
      return;
    }
    paneRef.current?.scrollTo({
      top: Math.max(0, match.line - 2) * ROW_HEIGHT,
    });
  }, [paneRef, searchIndex, searchMatches]);

  const onScroll = () => {
    if (scrollFrame.current !== 0) {
      return;
    }
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const top = paneRef.current?.scrollTop ?? 0;
      onLineChange(Math.max(1, Math.round(top / ROW_HEIGHT) + 1));
    });
  };

  return (
    <div className="diff-shell code-shell">
      <main
        ref={paneRef}
        className="diff-pane code-pane"
        data-panel="code-view"
        data-testid="code-pane"
        onScroll={onScroll}
      >
      {path ? (
        <div className="diff-view code-view" data-file-key={path}>
          <div
            className="diff-heading code-heading"
            data-layout-block="file-heading"
            data-file-key={path}
            data-testid="code-heading"
          >
            <span className="diff-heading-path">{path}</span>
            <span className="file-counts">
              {changeFile?.status ? (
                <span className={`file-status file-status-${changeFile.status}`}>
                  {statusLabel(changeFile.status)}
                </span>
              ) : null}
              {changeFile ? (
                <button
                  type="button"
                  className="code-mark-button"
                  onClick={onToggleMark}
                >
                  {changeFile.reviewed ? "Unmark" : "Mark reviewed"}
                </button>
              ) : null}
            </span>
          </div>

          {path && isMarkdownPath(path) ? (
            <div className="code-tabs" data-testid="code-tabs">
              <button
                type="button"
                role="tab"
                aria-selected={!preview}
                className={preview ? "code-tab" : "code-tab code-tab-active"}
                onClick={onShowCode}
              >
                Code
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={preview}
                className={preview ? "code-tab code-tab-active" : "code-tab"}
                onClick={onShowPreview}
              >
                Preview
              </button>
            </div>
          ) : null}

          {notice ? (
            <div className="code-notice" data-testid="code-notice">
              {notice}
            </div>
          ) : null}
          {loading ? <div className="diff-empty">Loading file…</div> : null}
          {error ? <div className="diff-empty">{error}</div> : null}

          {file ? (
            <div
              className={
                file.deleted ? "code-file code-file-deleted" : "code-file"
              }
            >
              {file.deleted ? (
                <div className="code-deleted-note">
                  deleted in this Selection — showing the before content
                </div>
              ) : null}
              {preview ? (
                <MarkdownPreview
                  text={file.text ?? ""}
                  path={path ?? file.path}
                  target={snapshotTarget}
                  side={side}
                  onOpenFile={onOpenFile}
                />
              ) : file.kind === "submodule" ? (
                <div className="diff-empty">
                  submodule {file.submoduleOid ?? ""}
                </div>
              ) : file.image && rawUrl ? (
                <figure className="image-preview">
                  <img src={rawUrl} alt={path} />
                </figure>
              ) : file.binary ? (
                <div className="diff-empty">
                  binary, {file.size} bytes
                </div>
              ) : file.kind === "symlink" ? (
                <div className="code-symlink">
                  symlink → {file.text ?? ""}
                </div>
              ) : (
                <>
                  {file.truncated ? (
                    <div className="code-notice" data-testid="code-truncated">
                      File truncated to 1 MB / 20,000 lines.{" "}
                      <button type="button" onClick={onLoadFull}>
                        load full file
                      </button>
                    </div>
                  ) : null}
                  <div
                    className="diff-lines code-lines"
                    data-layout-rows="true"
                    data-file-key={path}
                    data-row-height={ROW_HEIGHT}
                    data-row-count={lines.length}
                  >
                    {lines.map((line, index) => {
                      const lineNumber = index + 1;
                      const classes = [
                        "code-line",
                        marks?.sets.addLines.has(lineNumber)
                          ? "code-line-added"
                          : "",
                        marks?.sets.modifiedLines.has(lineNumber)
                          ? "code-line-modified"
                          : "",
                        marks?.sets.removedLines.has(lineNumber)
                          ? "code-line-removed"
                          : "",
                        marks?.sets.gaps.find(
                          (gap) => gap.line === lineNumber - 1,
                        )?.kind === "add"
                          ? "code-line-gap-add"
                          : "",
                        marks?.sets.gaps.find(
                          (gap) => gap.line === lineNumber - 1,
                        )?.kind === "delete"
                          ? "code-line-gap-delete"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      const lineTokens = tokens?.lines?.[index] ?? null;
                      return (
                        <div
                          key={index}
                          className={classes}
                          data-code-line={lineNumber}
                          style={{ height: ROW_HEIGHT }}
                        >
                          <span className="diff-line-number">{lineNumber}</span>
                          <span className="code-content">
                            {highlightSegments(
                              line,
                              lineTokens,
                              null,
                              searchRangesForLine(
                                searchMatches,
                                lineNumber,
                                searchIndex,
                              ),
                            ).map((segment, segmentIndex) => (
                              <span
                                key={segmentIndex}
                                className={[
                                  "syntax-token",
                                  segment.search ? "diff-search-match" : "",
                                  segment.current
                                    ? "diff-search-current"
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                style={segment.style as CSSProperties}
                              >
                                {segment.text}
                              </span>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="diff-empty">
          Select a file in the Snapshot tree or press Ctrl+P.
        </div>
      )}
      </main>
      {marks && !preview ? (
        <OverviewRuler overview={marks.overview} pane={paneRef} />
      ) : null}
    </div>
  );
}
