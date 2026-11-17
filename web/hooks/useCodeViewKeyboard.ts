import { useEffect, useMemo, useRef } from "react";
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import type { ChangeFile, SnapshotSide } from "../../shared/types";
import type { FolderTreeRow } from "../../shared/folder-tree";
import type { AppAction, AppState } from "../state/app-state";
import type { CodeTreePayload } from "../state/code-view";
import {
  beforeChangeMarks,
  changeMarks,
} from "../../shared/diff/change-marks";

interface Params {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly row: FolderTreeRow<CodeTreePayload> | null;
  readonly rows: readonly FolderTreeRow<CodeTreePayload>[];
  readonly expanded: ReadonlySet<string>;
  readonly openFile: ChangeFile | null;
  readonly side: SnapshotSide;
  readonly searchMatchCount: number;
  readonly searchOpen: boolean;
  readonly helpOpen: boolean;
  readonly markdownOpen: boolean;
  readonly markdownPreview: boolean;
  readonly onShowCode: () => void;
  readonly onTogglePreview: () => void;
  readonly paneRef: RefObject<HTMLElement | null>;
  readonly lineRef: MutableRefObject<number>;
  readonly changedPaths: readonly string[];
  readonly reveal: (path: string) => Promise<void>;
  readonly toggleFolder: (key: string) => void;
  readonly openRow: () => void;
  readonly toggleMark: () => void;
  readonly refreshRepository: () => void;
  readonly setSearchOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSearchIndex: Dispatch<SetStateAction<number>>;
  readonly setHelpOpen: Dispatch<SetStateAction<boolean>>;
  readonly setJump: Dispatch<
    SetStateAction<{ line: number; nonce: number } | null>
  >;
}

export function useCodeViewKeyboard({
  state,
  appDispatch,
  row,
  rows,
  expanded,
  openFile,
  side,
  searchMatchCount,
  searchOpen,
  helpOpen,
  markdownOpen,
  markdownPreview,
  onShowCode,
  onTogglePreview,
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
}: Params): void {
  const jumpNonce = useRef(0);

  const changeBlocks = useMemo(() => {
    if (!openFile) {
      return [];
    }
    if (side === "after") {
      const marks = changeMarks(openFile.hunks);
      return [...marks.added, ...marks.modified]
        .map((range) => range.start)
        .sort((left, right) => left - right);
    }
    const marks = beforeChangeMarks(openFile.hunks);
    return [...marks.removed, ...marks.modified]
      .map((range) => range.start)
      .sort((left, right) => left - right);
  }, [openFile, side]);

  const moveChanged = async (direction: 1 | -1) => {
    if (changedPaths.length === 0) {
      return;
    }
    const current = state.codeViewOpenPath;
    const index = current ? changedPaths.indexOf(current) : -1;
    const nextIndex =
      direction > 0
        ? Math.min(changedPaths.length - 1, index + 1)
        : Math.max(0, index === -1 ? 0 : index - 1);
    const target = changedPaths[nextIndex];
    if (target) {
      await reveal(target);
    }
  };

  const moveChange = (direction: 1 | -1) => {
    if (changeBlocks.length === 0) {
      return;
    }
    const current = lineRef.current;
    const next =
      direction > 0
        ? (changeBlocks.find((line) => line > current) ??
          changeBlocks[changeBlocks.length - 1])
        : ([...changeBlocks].reverse().find((line) => line < current) ??
          changeBlocks[0]);
    if (next !== undefined) {
      jumpNonce.current++;
      setJump({ line: next, nonce: jumpNonce.current });
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "d" || key === "u") {
          event.preventDefault();
          const pane = paneRef.current;
          pane?.scrollBy({
            top:
              (key === "d" ? 1 : -1) *
              Math.max(120, (pane.clientHeight || 600) * 0.8),
          });
          return;
        }
        if (key === "p") {
          event.preventDefault();
          appDispatch({ type: "code-view-finder-open" });
        }
        return;
      }
      if (event.altKey) {
        return;
      }
      if (helpOpen) {
        if (event.key === "Escape" || event.key === "?") {
          event.preventDefault();
          setHelpOpen(false);
        }
        return;
      }
      if (searchOpen) {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          setSearchOpen(false);
        }
        return;
      }
      if (state.codeViewFinderOpen) {
        return;
      }

      switch (event.key) {
        case "o":
          event.preventDefault();
          appDispatch({ type: "toggle-code-view" });
          break;
        case "b":
          event.preventDefault();
          appDispatch({
            type: "code-view-side",
            side: state.codeViewSide === "after" ? "before" : "after",
          });
          break;
        case "j":
        case "k":
          event.preventDefault();
          if (state.codeViewFocus === "tree") {
            appDispatch({
              type: "code-view-cursor",
              index: state.codeViewCursor + (event.key === "j" ? 1 : -1),
            });
          } else {
            paneRef.current?.scrollBy({
              top: (event.key === "j" ? 1 : -1) * 60,
            });
          }
          break;
        case "l":
          event.preventDefault();
          if (row?.kind === "folder") {
            toggleFolder(row.node.key);
          }
          break;
        case "h":
          event.preventDefault();
          if (row?.kind === "folder" && expanded.has(row.node.key)) {
            appDispatch({ type: "code-view-collapse", key: row.node.key });
          } else if (row?.parentFolderKey) {
            const index = rows.findIndex(
              (candidate) =>
                candidate.kind === "folder" &&
                candidate.node.key === row.parentFolderKey,
            );
            if (index >= 0) {
              appDispatch({ type: "code-view-cursor", index });
            }
          }
          break;
        case "Enter":
          event.preventDefault();
          openRow();
          break;
        case "Tab":
          event.preventDefault();
          appDispatch({
            type: "code-view-focus",
            focus: state.codeViewFocus === "tree" ? "code" : "tree",
          });
          break;
        case "0":
          event.preventDefault();
          appDispatch({ type: "code-view-focus", focus: "code" });
          break;
        case "}":
        case "{":
          event.preventDefault();
          void moveChanged(event.key === "}" ? 1 : -1);
          break;
        case "]":
        case "[":
          event.preventDefault();
          moveChange(event.key === "]" ? 1 : -1);
          break;
        case "m":
          event.preventDefault();
          toggleMark();
          break;
        case "p":
          if (state.codeViewFocus === "code" && markdownOpen) {
            event.preventDefault();
            onTogglePreview();
          }
          break;
        case "/":
          event.preventDefault();
          if (markdownOpen && markdownPreview) {
            onShowCode();
          }
          setSearchOpen(true);
          break;
        case "?":
          event.preventDefault();
          setHelpOpen(true);
          break;
        case "r":
          event.preventDefault();
          refreshRepository();
          break;
        case "n":
        case "N":
          if (searchMatchCount > 0) {
            event.preventDefault();
            setSearchIndex((current) => {
              const step = event.key === "n" ? 1 : -1;
              return (current + step + searchMatchCount) % searchMatchCount;
            });
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appDispatch,
    expanded,
    helpOpen,
    markdownOpen,
    markdownPreview,
    moveChanged,
    moveChange,
    onShowCode,
    onTogglePreview,
    openRow,
    paneRef,
    refreshRepository,
    row,
    rows,
    searchMatchCount,
    searchOpen,
    setHelpOpen,
    setSearchIndex,
    setSearchOpen,
    state.codeViewCursor,
    state.codeViewFinderOpen,
    state.codeViewFocus,
    state.codeViewSide,
    toggleFolder,
    toggleMark,
  ]);
}
