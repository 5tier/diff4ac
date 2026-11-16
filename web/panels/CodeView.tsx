import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type {
  ChangeFile,
  ChangeSet,
  Selection,
} from "../../shared/types";
import { visibleFolderTreeRows } from "../../shared/folder-tree";
import type { KeyBinding } from "../../shared/keymap";
import { setReviewMark, snapshotRawUrl } from "../api";
import type { AppAction, AppState } from "../state/app-state";
import {
  changeFileForPath,
  codeSearchMatches,
  snapshotTreeNodes,
  statusLabel,
  type CodeTreePayload,
} from "../state/code-view";
import { setChangeFileReviewState } from "../state/selection";
import { useSnapshot } from "../hooks/useSnapshot";
import { useCodeViewKeyboard } from "../hooks/useCodeViewKeyboard";
import { useCodeViewMemory } from "../hooks/useCodeViewMemory";
import { CodePane } from "./CodePane";
import { FolderTree } from "./FolderTree";
import { CodeHelp, FinderDialog } from "./CodeDialogs";

interface CodeViewProps {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly keymap: readonly KeyBinding[];
  readonly files: readonly ChangeFile[];
  readonly changeSetSelection: Selection | undefined;
  readonly worktreePath: string | null;
  readonly reviewPath: string | null;
  readonly agent: string | null;
  readonly refreshVersion: number;
  readonly refreshRepository: () => void;
  readonly setChangeSet: Dispatch<React.SetStateAction<ChangeSet | null>>;
  readonly setMarkError: Dispatch<React.SetStateAction<string | null>>;
  readonly selectionLabel: string;
}

export function CodeView({
  state,
  appDispatch,
  keymap,
  files,
  changeSetSelection,
  worktreePath,
  reviewPath,
  agent,
  refreshVersion,
  refreshRepository,
  setChangeSet,
  setMarkError,
  selectionLabel,
}: CodeViewProps) {
  const paneRef = useRef<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(
    null,
  );
  const lineRef = useRef(state.codeViewLine);
  const [notice, setNotice] = useState<string | null>(null);

  const openFile = changeFileForPath(
    files,
    state.codeViewOpenPath ?? "",
    state.codeViewSide,
  );
  // A file added in this Selection has no before-side object; requesting it
  // only produces a 404. The Snapshot API represents after-side deletions in
  // its response, so only the before side needs this guard.
  const sideMissing =
    state.codeViewSide === "before" &&
    openFile !== null &&
    (openFile.status === "added" || openFile.status === "untracked");

  const snapshot = useSnapshot({
    enabled: state.codeView,
    selection: changeSetSelection ?? state.selection,
    changeSetSelection,
    worktreePath,
    agent,
    side: state.codeViewSide,
    expanded: state.codeViewExpanded,
    openPath: sideMissing ? null : state.codeViewOpenPath,
    full: state.codeViewFull,
    refreshVersion,
    finderOpen: state.codeViewFinderOpen,
    finderQuery: state.codeViewFinderQuery,
  });

  const nodes = useMemo(
    () => snapshotTreeNodes(snapshot.entriesByDir),
    [snapshot.entriesByDir],
  );
  const expanded = useMemo(
    () => new Set(state.codeViewExpanded),
    [state.codeViewExpanded],
  );
  const rows = useMemo(
    () => visibleFolderTreeRows(nodes, expanded),
    [expanded, nodes],
  );
  const row = rows[state.codeViewCursor] ?? null;
  const changedPaths = useMemo(() => {
    const paths = files.map((file) =>
      state.codeViewSide === "before"
        ? (file.oldPath ?? file.path)
        : file.path,
    );
    return [...new Set(paths)].sort((left, right) =>
      left.localeCompare(right),
    );
  }, [files, state.codeViewSide]);
  const currentFile =
    snapshot.file?.path === state.codeViewOpenPath ? snapshot.file : null;
  const rawUrl = state.codeViewOpenPath
    ? snapshotRawUrl(snapshot.target, state.codeViewSide, state.codeViewOpenPath)
    : null;
  const searchMatches = codeSearchMatches(currentFile?.text, searchQuery);

  useCodeViewMemory({
    selection: changeSetSelection ?? state.selection,
    worktreePath,
    side: state.codeViewSide,
    reviewPath,
    expanded: state.codeViewExpanded,
    cursor: state.codeViewCursor,
    openPath: state.codeViewOpenPath,
    line: state.codeViewLine,
    lineRef,
    dispatch: appDispatch,
  });

  useEffect(() => {
    if (
      !state.codeViewOpenPath ||
      snapshot.missingPath !== state.codeViewOpenPath
    ) {
      return;
    }
    appDispatch({ type: "code-view-open", path: null });
    appDispatch({
      type: "code-view-notice",
      message: "That file is not in this Snapshot.",
    });
  }, [appDispatch, snapshot.missingPath, state.codeViewOpenPath]);

  useEffect(() => {
    if (!sideMissing || !state.codeViewOpenPath) {
      return;
    }
    appDispatch({ type: "code-view-open", path: null });
  }, [appDispatch, sideMissing, state.codeViewOpenPath]);

  useEffect(() => {
    if (state.codeViewCursor >= rows.length) {
      appDispatch({
        type: "code-view-cursor",
        index: Math.max(0, rows.length - 1),
      });
    }
  }, [appDispatch, rows.length, state.codeViewCursor]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    lineRef.current = state.codeViewLine;
  }, [state.codeViewLine, state.codeViewOpenPath]);

  useEffect(() => {
    if (!state.codeViewOpenPath) {
      return;
    }
    const index = rows.findIndex(
      (candidate) =>
        candidate.kind === "file" &&
        candidate.node.path === state.codeViewOpenPath,
    );
    if (index >= 0 && index !== state.codeViewCursor) {
      appDispatch({ type: "code-view-cursor", index });
    }
  }, [
    appDispatch,
    rows,
    state.codeViewCursor,
    state.codeViewOpenPath,
  ]);

  const reveal = useCallback(
    async (path: string, line = 1) => {
      const dirs = await snapshot.ensurePath(path);
      if (dirs.length > 0) {
        appDispatch({ type: "code-view-expand", keys: dirs });
      }
      appDispatch({ type: "code-view-open", path, line });
    },
    [appDispatch, snapshot],
  );

  const toggleFolder = useCallback(
    (key: string) => {
      const isExpanded = state.codeViewExpanded.includes(key);
      appDispatch({ type: "code-view-toggle-folder", key });
      if (!isExpanded) {
        void snapshot.loadDir(key);
      }
    },
    [appDispatch, snapshot, state.codeViewExpanded],
  );

  const openRow = () => {
    if (row?.kind === "folder") {
      toggleFolder(row.node.key);
    } else if (row?.kind === "file") {
      void reveal(row.node.path);
    }
  };

  const toggleMark = useCallback(() => {
    const target =
      state.codeViewFocus === "tree" && row?.kind === "file"
        ? changeFileForPath(files, row.node.path, state.codeViewSide)
        : openFile;
    if (!target) {
      setNotice("Only changed files can be marked.");
      return;
    }
    const reviewed = target.reviewed !== true;
    setNotice(null);
    setChangeSet((current) =>
      current
        ? setChangeFileReviewState(
            current,
            target.path,
            target.contentHash,
            reviewed,
          )
        : current,
    );
    void setReviewMark(target.path, target.contentHash, reviewed)
      .then(() => setNotice(reviewed ? "Marked reviewed." : "Mark removed."))
      .catch((reason: unknown) => {
        setChangeSet((current) =>
          current
            ? setChangeFileReviewState(
                current,
                target.path,
                target.contentHash,
                !reviewed,
              )
            : current,
        );
        setMarkError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });
  }, [
    files,
    openFile,
    row,
    setChangeSet,
    setMarkError,
    state.codeViewFocus,
    state.codeViewSide,
  ]);

  useCodeViewKeyboard({
    state,
    appDispatch,
    row,
    rows,
    expanded,
    openFile,
    side: state.codeViewSide,
    searchMatchCount: searchMatches.length,
    searchOpen,
    helpOpen,
    paneRef,
    lineRef,
    changedPaths,
    reveal,
    toggleFolder,
    openRow,
    toggleMark,
    refreshRepository,
    setSearchOpen,
    setSearchIndex,
    setHelpOpen,
    setJump,
  });

  return (
    <div className="code-view-layout" data-testid="code-view">
      <aside className="code-tree-panel">
        <header className="code-tree-header">
          <span>Code View</span>
          <span className="muted">
            {state.codeViewSide} · {selectionLabel}
          </span>
        </header>
        {snapshot.treeError ? (
          <div className="error">{snapshot.treeError}</div>
        ) : null}
        <FolderTree<CodeTreePayload>
          nodes={nodes}
          expanded={expanded}
          cursorIndex={state.codeViewCursor}
          onToggleFolder={(folder, index) => {
            appDispatch({ type: "code-view-cursor", index });
            toggleFolder(folder.key);
          }}
          folderClassName={(folder) =>
            folderContainsChanges(folder.path, files)
              ? "folder-row-changed"
              : ""
          }
          renderFolderExtra={(folder) =>
            folderContainsChanges(folder.path, files) ? (
              <span className="change-dot" data-testid="folder-change-dot">
                •
              </span>
            ) : null
          }
          renderFile={(file, fileState) => {
            const entry = file.payload.entry;
            const change = changeFileForPath(
              files,
              file.path,
              state.codeViewSide,
            );
            const classes = [
              "code-tree-file",
              entry.status ? `code-tree-status-${entry.status}` : "",
              entry.noise ? "code-tree-noise" : "",
              entry.status === "deleted" ? "code-tree-deleted" : "",
              change?.reviewed ? "code-tree-reviewed" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={file.key}>
                <button
                  type="button"
                  className={classes}
                  data-path={file.path}
                  data-status={entry.status ?? ""}
                  style={{ paddingLeft: "22px" }}
                  onClick={() => {
                    appDispatch({
                      type: "code-view-cursor",
                      index: fileState.rowIndex,
                    });
                    void reveal(file.path);
                  }}
                >
                  <span className="code-status">
                    {statusLabel(entry.status)}
                  </span>
                  {entry.noise ? <span className="change-dot">•</span> : null}
                  <span className="code-tree-name">{entry.name}</span>
                  {entry.renamedTo ? (
                    <span className="code-renamed"> → {entry.renamedTo}</span>
                  ) : null}
                  {change?.reviewed ? (
                    <span className="code-reviewed">✓</span>
                  ) : null}
                </button>
              </li>
            );
          }}
        />
      </aside>

      <CodePane
        file={currentFile}
        changeFile={openFile}
        side={state.codeViewSide}
        path={state.codeViewOpenPath}
        loading={snapshot.fileLoading}
        error={snapshot.fileError}
        notice={notice ?? state.codeViewNotice}
        rawUrl={rawUrl}
        searchMatches={searchMatches}
        searchIndex={searchIndex}
        initialLine={state.codeViewLine}
        jumpLine={jump}
        paneRef={paneRef}
        onLoadFull={() => {
          appDispatch({ type: "code-view-full", full: true });
        }}
        onToggleMark={toggleMark}
        onLineChange={(line) => {
          lineRef.current = line;
        }}
      />

      {searchOpen ? (
        <div className="code-search-bar">
          <input
            autoFocus
            value={searchQuery}
            aria-label="Search this file"
            placeholder="search this file"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <span className="muted">
            {searchMatches.length === 0
              ? "0 matches"
              : `${searchIndex + 1}/${searchMatches.length}`}
          </span>
        </div>
      ) : null}

      {state.codeViewFinderOpen ? (
        <FinderDialog
          state={state}
          appDispatch={appDispatch}
          results={snapshot.finderResults}
          loading={snapshot.finderLoading}
          onChoose={(path) => {
            void reveal(path);
          }}
        />
      ) : null}

      {helpOpen ? (
        <CodeHelp keymap={keymap} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}

function folderContainsChanges(
  folderPath: string,
  files: readonly ChangeFile[],
): boolean {
  return files.some(
    (file) =>
      file.path.startsWith(`${folderPath}/`) ||
      (file.oldPath?.startsWith(`${folderPath}/`) ?? false),
  );
}
