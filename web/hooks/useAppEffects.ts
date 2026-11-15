import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  BranchSummary,
  CommitSummary,
  WatchStatus,
  WorktreeSummary,
} from "../../shared/types";
import { fetchConfig } from "../api";
import type { KeybindingOverrides } from "../../shared/keymap";
import {
  applyTheme,
  readThemePreference,
  watchSystemTheme,
} from "../theme";
import type { AppAction, AppState } from "../state/app-state";

export interface UseAppEffectsParams {
  readonly state: AppState;
  readonly appDispatch: Dispatch<AppAction>;
  readonly allCommits: readonly CommitSummary[];
  readonly worktrees: readonly WorktreeSummary[];
  readonly branches: readonly BranchSummary[];
  readonly commits: readonly CommitSummary[];
  readonly fileRowCount: number;
  readonly selectedWorktreePath: string | null;
  readonly setKeybindingOverrides: Dispatch<SetStateAction<KeybindingOverrides>>;
  readonly setNoisePatterns: Dispatch<SetStateAction<readonly string[]>>;
  readonly setWatchStatuses: Dispatch<SetStateAction<readonly WatchStatus[]>>;
}

export function useAppEffects({
  state,
  appDispatch,
  allCommits,
  worktrees,
  branches,
  commits,
  fileRowCount,
  selectedWorktreePath,
  setKeybindingOverrides,
  setNoisePatterns,
  setWatchStatuses,
}: UseAppEffectsParams): void {
  const { theme, diffView, fullFile, filesView, agentFilter } = state;

  useEffect(() => {
    const controller = new AbortController();

    fetchConfig(controller.signal)
      .then((config) => {
        setKeybindingOverrides(config.keybindings);
        setNoisePatterns(config.noise);
        setWatchStatuses(config.watch ?? []);
        if (readThemePreference() === null) {
          appDispatch({ type: "set-theme", theme: config.theme });
        }
      })
      .catch(() => {
        // Config is optional; defaults remain in force.
      });

    return () => controller.abort();
  }, [
    appDispatch,
    setKeybindingOverrides,
    setNoisePatterns,
    setWatchStatuses,
  ]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  useEffect(() => {
    if (
      agentFilter &&
      !allCommits.some((commit) => commit.agent === agentFilter)
    ) {
      appDispatch({ type: "set-agent-filter", agent: null });
    }
  }, [agentFilter, allCommits, appDispatch]);

  useEffect(() => {
    try {
      sessionStorage.setItem("diff4ac-diff-view", diffView);
    } catch {
      return;
    }
  }, [diffView]);

  useEffect(() => {
    try {
      sessionStorage.setItem("diff4ac-full-file", fullFile ? "1" : "0");
    } catch {
      return;
    }
  }, [fullFile]);

  useEffect(() => {
    try {
      sessionStorage.setItem("diff4ac-files-view", filesView);
    } catch {
      return;
    }
  }, [filesView]);

  useEffect(() => {
    appDispatch({
      type: "clamp-cursor",
      panel: "worktrees",
      count: worktrees.length,
    });
  }, [appDispatch, worktrees.length]);

  useEffect(() => {
    appDispatch({
      type: "clamp-cursor",
      panel: "branches",
      count: branches.length,
    });
  }, [appDispatch, branches.length]);

  useEffect(() => {
    appDispatch({
      type: "clamp-cursor",
      panel: "commits",
      count: commits.length,
    });
  }, [appDispatch, commits.length]);

  useEffect(() => {
    appDispatch({
      type: "clamp-cursor",
      panel: "files",
      count: fileRowCount,
    });
  }, [appDispatch, fileRowCount]);

  useEffect(() => {
    if (selectedWorktreePath) {
      return;
    }
    const currentIndex = worktrees.findIndex((worktree) => worktree.current);
    if (currentIndex >= 0) {
      appDispatch({
        type: "set-cursor",
        panel: "worktrees",
        index: currentIndex,
      });
    }
  }, [appDispatch, selectedWorktreePath, worktrees]);
}
