import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  BaseBranch,
  BranchSummary,
  ChangeSet,
  CommitSummary,
  WorktreeInfo,
  WorktreeSummary,
} from "../../shared/types";
import {
  fetchBranches,
  fetchCommits,
  fetchWorktrees,
  subscribeRepositoryChanges,
} from "../api";

export interface RepositoryData {
  readonly pending: ChangeSet | null;
  readonly setPending: Dispatch<SetStateAction<ChangeSet | null>>;
  readonly worktrees: readonly WorktreeSummary[];
  readonly worktreesError: string | null;
  readonly selectedWorktreePath: string | null;
  readonly setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
  readonly allCommits: readonly CommitSummary[];
  readonly hasMoreCommits: boolean;
  readonly loadingMoreCommits: boolean;
  readonly loadMoreCommits: () => void;
  readonly commitsError: string | null;
  readonly branches: readonly BranchSummary[];
  readonly baseBranch: BaseBranch | null;
  readonly branchesError: string | null;
  readonly worktree: WorktreeInfo | null;
  readonly setWorktree: Dispatch<SetStateAction<WorktreeInfo | null>>;
  readonly repositoryChanged: boolean;
  readonly setRepositoryChanged: Dispatch<SetStateAction<boolean>>;
  readonly refreshNotice: string | null;
  readonly setRefreshNotice: Dispatch<SetStateAction<string | null>>;
  readonly refreshVersion: number;
  readonly refreshRepository: () => void;
}

export function useRepositoryData(): RepositoryData {
  const [pending, setPending] = useState<ChangeSet | null>(null);
  const [worktrees, setWorktrees] = useState<readonly WorktreeSummary[]>([]);
  const [worktreesError, setWorktreesError] = useState<string | null>(null);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<
    string | null
  >(null);
  const [allCommits, setAllCommits] = useState<readonly CommitSummary[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const allCommitsRef = useRef<readonly CommitSummary[]>(allCommits);
  const hasMoreCommitsRef = useRef(hasMoreCommits);
  const loadingMoreRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  allCommitsRef.current = allCommits;
  hasMoreCommitsRef.current = hasMoreCommits;
  const [branches, setBranches] = useState<readonly BranchSummary[]>([]);
  const [baseBranch, setBaseBranch] = useState<BaseBranch | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
  const [repositoryChanged, setRepositoryChanged] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMoreCommits(false);

    const controller = new AbortController();

    fetchCommits(controller.signal, selectedWorktreePath)
      .then((list) => {
        setAllCommits(list.commits);
        setHasMoreCommits(list.hasMore);
        setWorktree(list.worktree);
        setCommitsError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setCommitsError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => controller.abort();
  }, [selectedWorktreePath, refreshVersion]);

  const loadMoreCommits = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreCommitsRef.current) {
      return;
    }

    const skip = allCommitsRef.current.length;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMoreCommits(true);

    fetchCommits(controller.signal, selectedWorktreePath, skip)
      .then((list) => {
        setAllCommits((current) => {
          const seen = new Set(current.map((commit) => commit.hash));
          return [
            ...current,
            ...list.commits.filter((commit) => !seen.has(commit.hash)),
          ];
        });
        setHasMoreCommits(list.hasMore);
        setCommitsError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setCommitsError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        loadingMoreRef.current = false;
        setLoadingMoreCommits(false);
      });
  }, [selectedWorktreePath]);

  useEffect(() => {
    const controller = new AbortController();

    fetchWorktrees(controller.signal)
      .then((list) => {
        setWorktrees(list.worktrees);
        setWorktreesError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setWorktreesError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });

    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();

    fetchBranches(controller.signal, selectedWorktreePath)
      .then((list) => {
        setBranches(list.branches);
        setBaseBranch(list.baseBranch);
        setWorktree(list.worktree);
        setBranchesError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setBranchesError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });

    return () => controller.abort();
  }, [selectedWorktreePath, refreshVersion]);

  useEffect(
    () => subscribeRepositoryChanges(() => setRepositoryChanged(true)),
    [],
  );

  const refreshRepository = useCallback(() => {
    setRepositoryChanged(false);
    setRefreshNotice(null);
    setRefreshVersion((version) => version + 1);
  }, []);

  return {
    pending,
    setPending,
    worktrees,
    worktreesError,
    selectedWorktreePath,
    setSelectedWorktreePath,
    allCommits,
    hasMoreCommits,
    loadingMoreCommits,
    loadMoreCommits,
    commitsError,
    branches,
    baseBranch,
    branchesError,
    worktree,
    setWorktree,
    repositoryChanged,
    setRepositoryChanged,
    refreshNotice,
    setRefreshNotice,
    refreshVersion,
    refreshRepository,
  };
}
