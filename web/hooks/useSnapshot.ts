import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeSet,
  Selection,
  SnapshotFile,
  SnapshotPathMatch,
  SnapshotSide,
  SnapshotTreeEntry,
} from "../../shared/types";
import {
  fetchSnapshotFile,
  fetchSnapshotTree,
  searchSnapshotPaths,
  type FileRequestContext,
} from "../api";
import { ApiError } from "../api-error";
import { ancestorDirs } from "../state/code-view";

export interface UseSnapshotParams {
  readonly enabled: boolean;
  readonly selection: Selection;
  readonly worktreePath: string | null;
  readonly agent: string | null;
  readonly side: SnapshotSide;
  readonly expanded: readonly string[];
  readonly openPath: string | null;
  readonly full: boolean;
  readonly refreshVersion: number;
  readonly finderOpen: boolean;
  readonly finderQuery: string;
  readonly changeSetSelection?: Selection;
}

export interface SnapshotState {
  readonly target: FileRequestContext;
  readonly entriesByDir: ReadonlyMap<string, readonly SnapshotTreeEntry[]>;
  readonly file: SnapshotFile | null;
  readonly fileLoading: boolean;
  readonly fileError: string | null;
  readonly missingPath: string | null;
  readonly treeError: string | null;
  readonly finderResults: readonly SnapshotPathMatch[];
  readonly finderLoading: boolean;
  readonly loadDir: (dir: string) => Promise<void>;
  readonly ensurePath: (path: string) => Promise<readonly string[]>;
}

export function useSnapshot({
  enabled,
  selection,
  worktreePath,
  agent,
  side,
  expanded,
  openPath,
  full,
  refreshVersion,
  finderOpen,
  finderQuery,
  changeSetSelection,
}: UseSnapshotParams): SnapshotState {
  const [entriesByDir, setEntriesByDir] = useState<
    ReadonlyMap<string, readonly SnapshotTreeEntry[]>
  >(() => new Map());
  const [file, setFile] = useState<SnapshotFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [missingPath, setMissingPath] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [finderResults, setFinderResults] = useState<
    readonly SnapshotPathMatch[]
  >([]);
  const [finderLoading, setFinderLoading] = useState(false);

  const target = useMemo<FileRequestContext>(
    () => ({
      selection: changeSetSelection ?? selection,
      worktreePath,
      agent,
    }),
    [agent, changeSetSelection, selection, worktreePath],
  );
  const targetRef = useRef(target);
  targetRef.current = target;
  const generation = useRef(0);
  const loadingDirs = useRef(new Set<string>());
  const entriesRef = useRef(entriesByDir);
  entriesRef.current = entriesByDir;

  const loadDir = useCallback(
    async (dir: string): Promise<void> => {
      if (entriesRef.current.has(dir) || loadingDirs.current.has(dir)) {
        return;
      }
      loadingDirs.current.add(dir);
      const current = generation.current;
      try {
        const entries = await fetchSnapshotTree(
          targetRef.current,
          side,
          dir,
        );
        if (current !== generation.current) {
          return;
        }
        setEntriesByDir((previous) => {
          if (previous.has(dir)) {
            return previous;
          }
          const next = new Map(previous);
          next.set(dir, entries);
          return next;
        });
        setTreeError(null);
      } catch (reason) {
        if (current === generation.current) {
          setTreeError(
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      } finally {
        loadingDirs.current.delete(dir);
      }
    },
    [side],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    generation.current++;
    loadingDirs.current.clear();
    const empty = new Map<string, readonly SnapshotTreeEntry[]>();
    entriesRef.current = empty;
    setEntriesByDir(empty);
    setTreeError(null);
    setFile(null);
    setFileError(null);
    void loadDir("");
  }, [enabled, loadDir, refreshVersion, selection, side, worktreePath]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    for (const dir of expanded) {
      void loadDir(dir);
    }
  }, [enabled, expanded, loadDir, refreshVersion]);

  useEffect(() => {
    if (!enabled || !openPath) {
      setFile(null);
      setFileError(null);
      setMissingPath(null);
      return;
    }

    const controller = new AbortController();
    // Do not show the previous file under the new path while this one loads.
    setFile(null);
    setFileLoading(true);
    setFileError(null);
    setMissingPath(null);
    fetchSnapshotFile(target, side, openPath, full, controller.signal)
      .then((loaded) => {
        setFile(loaded);
        setFileLoading(false);
        setMissingPath(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setFile(null);
        setFileLoading(false);
        setMissingPath(
          reason instanceof ApiError && reason.status === 404
            ? openPath
            : null,
        );
        setFileError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => controller.abort();
  }, [enabled, full, openPath, refreshVersion, side, target]);

  useEffect(() => {
    if (!enabled || !finderOpen) {
      setFinderResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setFinderLoading(true);
      searchSnapshotPaths(
        target,
        side,
        finderQuery,
        50,
        controller.signal,
      )
        .then((results) => {
          setFinderResults(results);
          setFinderLoading(false);
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") {
            return;
          }
          setFinderResults([]);
          setFinderLoading(false);
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, finderOpen, finderQuery, side, target]);

  const ensurePath = useCallback(
    async (path: string): Promise<readonly string[]> => {
      const dirs = ancestorDirs(path);
      for (const dir of dirs) {
        await loadDir(dir);
      }
      return dirs;
    },
    [loadDir],
  );

  return {
    target,
    entriesByDir,
    file,
    fileLoading,
    fileError,
    missingPath,
    treeError,
    finderResults,
    finderLoading,
    loadDir,
    ensurePath,
  };
}

export type SnapshotAwareChangeSet = ChangeSet;
