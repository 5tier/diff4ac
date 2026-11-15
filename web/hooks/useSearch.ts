import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { CommitChangeGroup } from "../../shared/types";
import type { DiffViewMode } from "../../shared/diff/rows";
import type { DiffJump } from "../DiffView";
import {
  buildChangeOverview,
  type OverviewFile,
} from "../../shared/diff/overview";
import {
  findSearchMatches,
  type SearchFile,
  type SearchMatch,
} from "../../shared/diff/search";
import { hunkAtRow, type HunkLocation } from "../../shared/diff/navigation";
import {
  fileKeyAtOffset,
  rowAtOffset,
} from "../../shared/diff/layout";
import { measureDiffLayout } from "../diff-layout";
import type { ChangeFile } from "../../shared/types";
import type { AppAction } from "../state/app-state";
import { stackFileIndices, stackFileKey } from "../state/selection";

export interface UseSearchParams {
  readonly files: readonly ChangeFile[];
  readonly commitGroups: readonly CommitChangeGroup[];
  readonly isStack: boolean;
  readonly selectedPath: string | null;
  readonly searchQuery: string;
  readonly searchOpen: boolean;
  readonly matchIndex: number;
  readonly diffView: DiffViewMode;
  readonly appDispatch: Dispatch<AppAction>;
  readonly diffRef: MutableRefObject<HTMLElement | null>;
  /** File-row index for a file key in the current Files panel mode. */
  readonly fileCursorForKey?: (fileKey: string) => number | undefined;
}

export interface SearchState {
  readonly searchFiles: readonly SearchFile[];
  readonly overviewFiles: readonly OverviewFile[];
  readonly changeOverview: ReturnType<typeof buildChangeOverview>;
  readonly searchMatches: readonly SearchMatch[];
  readonly searchActive: boolean;
  readonly currentMatch: SearchMatch | null;
  readonly collapsedSearchFiles: number;
  readonly jump: DiffJump | null;
  readonly updateSearchQuery: (value: string) => void;
  readonly clearSearch: () => void;
  readonly commitSearch: () => void;
  readonly jumpToTarget: (
    fileKey: string,
    row: number,
    fileCursor?: number,
  ) => void;
  readonly jumpToMatch: (index: number) => void;
  readonly currentDiffFileKey: () => string | null;
  readonly currentHunkLocation: () => HunkLocation | null;
}

export function useSearch({
  files,
  commitGroups,
  isStack,
  selectedPath,
  searchQuery,
  searchOpen,
  matchIndex,
  diffView,
  appDispatch,
  diffRef,
  fileCursorForKey,
}: UseSearchParams): SearchState {
  const [jump, setJump] = useState<DiffJump | null>(null);
  const jumpNonce = useRef(0);

  const stackFileIndex = useMemo(
    () => stackFileIndices(commitGroups),
    [commitGroups],
  );

  const searchFiles = useMemo<SearchFile[]>(() => {
    if (isStack) {
      return commitGroups.flatMap((group) =>
        group.files.map((file) => ({
          key: stackFileKey(group.commit.hash, file.path),
          path: file.path,
          hunks: file.hunks,
          ...(file.collapsed ? { collapsed: true } : {}),
        })),
      );
    }

    return files.map((file) => ({
      key: file.path,
      path: file.path,
      hunks: file.hunks,
      ...(file.collapsed ? { collapsed: true } : {}),
    }));
  }, [commitGroups, files, isStack]);

  const overviewFiles = useMemo<OverviewFile[]>(() => {
    if (isStack) {
      return commitGroups.flatMap((group) =>
        group.files.map((file) => ({
          key: stackFileKey(group.commit.hash, file.path),
          hunks: file.hunks,
          ...(file.collapsed ? { collapsed: true } : {}),
          ...(file.binary ? { binary: true } : {}),
        })),
      );
    }

    return files
      .filter((file) => file.path === selectedPath)
      .map((file) => ({
        key: file.path,
        hunks: file.hunks,
        ...(file.collapsed ? { collapsed: true } : {}),
        ...(file.binary ? { binary: true } : {}),
      }));
  }, [commitGroups, files, isStack, selectedPath]);

  const changeOverview = useMemo(
    () => buildChangeOverview(overviewFiles, diffView),
    [diffView, overviewFiles],
  );

  const searchMatches = useMemo(
    () => findSearchMatches(searchFiles, searchQuery, diffView),
    [diffView, searchFiles, searchQuery],
  );
  const searchActive = searchQuery.trim() !== "" && !searchOpen;
  const currentMatch =
    matchIndex >= 0 ? (searchMatches[matchIndex] ?? null) : null;
  const collapsedSearchFiles =
    searchQuery.trim() !== ""
      ? searchFiles.filter((file) => file.collapsed === true).length
      : 0;

  useEffect(() => {
    appDispatch({ type: "clamp-match-index", count: searchMatches.length });
  }, [appDispatch, searchMatches]);

  const selectSearchFile = useCallback(
    (fileKey: string, fileCursor?: number) => {
      if (isStack) {
        const file = searchFiles.find((candidate) => candidate.key === fileKey);
        if (!file) {
          return;
        }
        appDispatch({
          type: "set-file-selection",
          path: file.path,
          index: fileCursor ?? stackFileIndex.get(fileKey) ?? 0,
        });
        return;
      }

      const index =
        fileCursor ?? files.findIndex((file) => file.path === fileKey);
      if (index >= 0) {
        appDispatch({ type: "set-file-selection", path: fileKey, index });
      }
    },
    [appDispatch, files, isStack, searchFiles, stackFileIndex],
  );

  const jumpToTarget = useCallback(
    (fileKey: string, row: number, fileCursor?: number) => {
      const index = fileCursor ?? fileCursorForKey?.(fileKey);
      selectSearchFile(fileKey, index);
      jumpNonce.current += 1;
      setJump({ fileKey, row, nonce: jumpNonce.current });
    },
    [fileCursorForKey, jumpNonce, selectSearchFile],
  );

  useEffect(() => {
    if (jump) {
      setJump(null);
    }
  }, [jump]);

  const jumpToMatch = useCallback(
    (index: number) => {
      const match = searchMatches[index];
      if (!match) {
        return;
      }
      appDispatch({ type: "set-match-index", index });
      jumpToTarget(match.fileKey, match.row);
    },
    [appDispatch, jumpToTarget, searchMatches],
  );

  const updateSearchQuery = useCallback(
    (value: string) => {
      appDispatch({ type: "search-query", value });
    },
    [appDispatch],
  );

  const clearSearch = useCallback(() => {
    appDispatch({ type: "search-clear" });
  }, [appDispatch]);

  const commitSearch = useCallback(() => {
    appDispatch({ type: "search-commit" });
    const index =
      matchIndex >= 0 && matchIndex < searchMatches.length ? matchIndex : 0;
    if (searchMatches[index]) {
      jumpToMatch(index);
    }
  }, [appDispatch, jumpToMatch, matchIndex, searchMatches]);

  const currentDiffFileKey = useCallback((): string | null => {
    if (!isStack) {
      return selectedPath;
    }

    const pane = diffRef.current;
    if (!pane) {
      return null;
    }
    const layout = measureDiffLayout(pane);
    return fileKeyAtOffset(layout, pane.scrollTop + layout.stickyHeight);
  }, [diffRef, isStack, selectedPath]);

  const currentHunkLocation = useCallback((): HunkLocation | null => {
    const fileKey = currentDiffFileKey();
    const pane = diffRef.current;
    if (!fileKey || !pane) {
      return null;
    }
    const layout = measureDiffLayout(pane);
    const file = layout.files.get(fileKey);
    if (!file) {
      return null;
    }
    const row = rowAtOffset(file, pane.scrollTop + layout.stickyHeight);
    return (
      hunkAtRow(searchFiles, diffView, fileKey, row) ?? {
        fileKey,
        hunkIndex: -1,
      }
    );
  }, [currentDiffFileKey, diffView, diffRef, searchFiles]);

  return {
    searchFiles,
    overviewFiles,
    changeOverview,
    searchMatches,
    searchActive,
    currentMatch,
    collapsedSearchFiles,
    jump,
    updateSearchQuery,
    clearSearch,
    commitSearch,
    jumpToTarget,
    jumpToMatch,
    currentDiffFileKey,
    currentHunkLocation,
  };
}
