import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ChangeFile,
  ChangeSet,
  FilterRequest,
  Selection,
  WorktreeInfo,
} from "../../src/types";
import type { FileRequestContext } from "../api";
import {
  fetchBranch,
  fetchCommit,
  fetchCommitSet,
  fetchFileDiff,
  fetchPending,
  fetchTimeWindow,
  fetchWorktreePending,
} from "../api";
import type { AppAction } from "../state/app-state";
import {
  fullFileCacheKey,
  isNotFoundError,
  missingSelectionLabel,
  sameTimeWindowSelection,
  selectionCacheKey,
  stackFileIndices,
} from "../state/selection";

export interface UseChangeSetParams {
  readonly selection: Selection;
  readonly selectedPath: string | null;
  readonly selectedWorktreePath: string | null;
  readonly agentFilter: string | null;
  readonly fullFile: boolean;
  readonly filterRequest: FilterRequest;
  readonly listFilterRequest: FilterRequest;
  readonly refreshVersion: number;
  readonly appDispatch: Dispatch<AppAction>;
  readonly setPending: Dispatch<SetStateAction<ChangeSet | null>>;
  readonly setWorktree: Dispatch<SetStateAction<WorktreeInfo | null>>;
  readonly setRepositoryChanged: Dispatch<SetStateAction<boolean>>;
  readonly setRefreshNotice: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
}

export interface ChangeSetState {
  readonly changeSet: ChangeSet | null;
  readonly setChangeSet: Dispatch<SetStateAction<ChangeSet | null>>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly markError: string | null;
  readonly setMarkError: Dispatch<SetStateAction<string | null>>;
  readonly diffError: string | null;
  readonly setDiffError: Dispatch<SetStateAction<string | null>>;
  readonly preserveOnNextLoad: MutableRefObject<boolean>;
  readonly markPreserve: () => void;
  readonly diffRef: MutableRefObject<HTMLElement | null>;
  readonly commitGroups: NonNullable<ChangeSet["commitGroups"]>;
  readonly isStack: boolean;
  readonly stackFileIndex: Map<string, number>;
  readonly files: readonly ChangeFile[];
  readonly fileContext: FileRequestContext;
  readonly filterInfo: ChangeSet["filter"];
  readonly hiddenFiles: number;
  readonly selected: ChangeFile | null;
}

export function useChangeSet({
  selection,
  selectedPath,
  selectedWorktreePath,
  agentFilter,
  fullFile,
  filterRequest,
  listFilterRequest,
  refreshVersion,
  appDispatch,
  setPending,
  setWorktree,
  setRepositoryChanged,
  setRefreshNotice,
  setSelectedWorktreePath,
}: UseChangeSetParams): ChangeSetState {
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null);
  const [fullFiles, setFullFiles] = useState<ReadonlyMap<string, ChangeFile>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const diffRef = useRef<HTMLElement | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  selectedPathRef.current = selectedPath;
  const preserveOnNextLoad = useRef(false);
  const pendingScrollTop = useRef<number | null>(null);

  const markPreserve = useMemo(() => () => {
    preserveOnNextLoad.current = true;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const preserve = preserveOnNextLoad.current;
    preserveOnNextLoad.current = false;
    const previousPath = selectedPathRef.current;
    const previousScroll = diffRef.current?.scrollTop ?? null;

    setError(null);
    appDispatch({ type: "load-start", preserve });
    if (!preserve) {
      setLoading(true);
      setChangeSet(null);
    }
    setFullFiles((current) => (current.size === 0 ? current : new Map()));

    const request =
      selection.kind === "pending"
        ? selectedWorktreePath
          ? fetchWorktreePending(
              selectedWorktreePath,
              controller.signal,
              listFilterRequest,
            )
          : fetchPending(controller.signal, listFilterRequest)
        : selection.kind === "commit"
          ? fetchCommit(
              selection.commit.hash,
              controller.signal,
              selectedWorktreePath,
              listFilterRequest,
            )
          : selection.kind === "commits"
            ? fetchCommitSet(
                selection.commits.map((commit) => commit.hash),
                selection.mode,
                controller.signal,
                selectedWorktreePath,
                listFilterRequest,
              )
            : selection.kind === "time-window"
              ? fetchTimeWindow(
                  selection.window,
                  selection.mode,
                  controller.signal,
                  selectedWorktreePath,
                  agentFilter,
                  listFilterRequest,
                )
              : fetchBranch(
                  selection.branch.name,
                  controller.signal,
                  selectedWorktreePath,
                  listFilterRequest,
                );

    request
      .then((loaded) => {
        setChangeSet(loaded);
        setWorktree(loaded.worktree);
        if (loaded.selection.kind === "pending") {
          setPending(loaded);
        }

        const nextPath =
          preserve &&
          previousPath &&
          loaded.files.some((file) => file.path === previousPath)
            ? previousPath
            : (loaded.files[0]?.path ?? null);
        const nextIndex = nextPath
          ? loaded.files.findIndex((file) => file.path === nextPath)
          : -1;

        const selectionUpdate =
          loaded.selection.kind === "time-window" &&
          selection.kind === "time-window" &&
          !sameTimeWindowSelection(selection, loaded.selection)
            ? loaded.selection
            : undefined;

        appDispatch({
          type: "change-set-loaded",
          selectedPath: nextPath,
          fileCursor: preserve && nextIndex >= 0 ? nextIndex : 0,
          ...(selectionUpdate ? { selection: selectionUpdate } : {}),
        });
        if (preserve && previousScroll !== null) {
          pendingScrollTop.current = previousScroll;
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }

        if (preserve && isNotFoundError(reason)) {
          setRepositoryChanged(false);
          setError(null);
          setLoading(false);
          appDispatch({ type: "selection-missing" });
          setRefreshNotice(
            `${missingSelectionLabel(selection)} no longer exists — showing Pending.`,
          );
          if (selection.kind === "pending") {
            setSelectedWorktreePath(null);
          }
          return;
        }

        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    return () => controller.abort();
  }, [
    appDispatch,
    listFilterRequest,
    refreshVersion,
    selection,
    selectedWorktreePath,
    setPending,
    setRefreshNotice,
    setRepositoryChanged,
    setSelectedWorktreePath,
    setWorktree,
  ]);

  useEffect(() => {
    if (loading || pendingScrollTop.current === null) {
      return;
    }
    const top = pendingScrollTop.current;
    pendingScrollTop.current = null;
    requestAnimationFrame(() => {
      diffRef.current?.scrollTo({ top });
    });
  }, [changeSet, loading]);

  const commitGroups = changeSet?.commitGroups ?? [];
  const isStack =
    (changeSet?.selection.kind === "commits" ||
      changeSet?.selection.kind === "time-window") &&
    changeSet.selection.mode === "stack";
  const stackFileIndex = useMemo(
    () => stackFileIndices(commitGroups),
    [commitGroups],
  );

  const baselineFiles = changeSet?.files ?? [];
  const files = useMemo<readonly ChangeFile[]>(() => {
    if (!fullFile || isStack || fullFiles.size === 0) {
      return baselineFiles;
    }

    const selectionKey = selectionCacheKey(changeSet?.selection);
    let replaced = false;
    const next = baselineFiles.map((file) => {
      const rev = file.newRev ?? file.oldRev;
      const cached = fullFiles.get(
        fullFileCacheKey(selectionKey, file.path, rev),
      );
      if (!cached) {
        return file;
      }
      replaced = true;
      return cached.reviewed === file.reviewed
        ? cached
        : { ...cached, reviewed: file.reviewed };
    });
    return replaced ? next : baselineFiles;
  }, [baselineFiles, changeSet?.selection, fullFile, fullFiles, isStack]);

  const fileContext = useMemo<FileRequestContext>(
    () => ({
      selection: changeSet?.selection ?? selection,
      worktreePath: selectedWorktreePath,
      agent: agentFilter,
      filters: filterRequest,
    }),
    [
      agentFilter,
      changeSet?.selection,
      filterRequest,
      selectedWorktreePath,
      selection,
    ],
  );
  const filterInfo = changeSet?.filter;
  const hiddenFiles = filterInfo?.hiddenFiles ?? 0;
  const selected = files.find((file) => file.path === selectedPath) ?? null;

  useEffect(() => {
    if (!fullFile || isStack || !changeSet || !selected) {
      return;
    }
    if (selected.binary || selected.collapsed) {
      return;
    }

    const rev = selected.newRev ?? selected.oldRev;
    const key = fullFileCacheKey(
      selectionCacheKey(changeSet.selection),
      selected.path,
      rev,
    );
    if (fullFiles.has(key)) {
      return;
    }

    const controller = new AbortController();
    fetchFileDiff(fileContext, selected.path, rev, {
      signal: controller.signal,
      fullContext: true,
    })
      .then((file) => {
        setFullFiles((current) =>
          current.has(key) ? current : new Map(current).set(key, file),
        );
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        // Keep showing the hunks-only version; this is an optional upgrade.
      });

    return () => controller.abort();
  }, [changeSet, fileContext, fullFile, fullFiles, isStack, selected]);

  return {
    changeSet,
    setChangeSet,
    loading,
    error,
    markError,
    setMarkError,
    diffError,
    setDiffError,
    preserveOnNextLoad,
    markPreserve,
    diffRef,
    commitGroups,
    isStack,
    stackFileIndex,
    files,
    fileContext,
    filterInfo,
    hiddenFiles,
    selected,
  };
}
