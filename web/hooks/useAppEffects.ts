import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  BranchSummary,
  ChangeFile,
  CommitSummary,
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
  readonly files: readonly ChangeFile[];
  readonly selectedWorktreePath: string | null;
  readonly setKeybindingOverrides: Dispatch<SetStateAction<KeybindingOverrides>>;
  readonly setNoisePatterns: Dispatch<SetStateAction<readonly string[]>>;
}

export function useAppEffects({
  state,
  appDispatch,
  allCommits,
  worktrees,
  branches,
  commits,
  files,
  selectedWorktreePath,
  setKeybindingOverrides,
  setNoisePatterns,
}: UseAppEffectsParams): void {
  const { theme, diffView, fullFile, agentFilter } = state;

  useEffect(() => {
    const controller = new AbortController();

    fetchConfig(controller.signal)
      .then((config) => {
        setKeybindingOverrides(config.keybindings);
        setNoisePatterns(config.noise);
        if (readThemePreference() === null) {
          appDispatch({ type: "set-theme", theme: config.theme });
        }
      })
      .catch(() => {
        // Config is optional; defaults remain in force.
      });

    return () => controller.abort();
  }, [appDispatch, setKeybindingOverrides, setNoisePatterns]);

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
      count: files.length,
    });
  }, [appDispatch, files.length]);

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
