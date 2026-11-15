import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  BaseBranch,
  BranchSummary,
  ChangeSet,
  CommitSummary,
  WorktreeInfo,
  WorktreeSummary,
} from "../../src/types";
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
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<readonly BranchSummary[]>([]);
  const [baseBranch, setBaseBranch] = useState<BaseBranch | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
  const [repositoryChanged, setRepositoryChanged] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchCommits(controller.signal, selectedWorktreePath)
      .then((list) => {
        setAllCommits(list.commits);
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
