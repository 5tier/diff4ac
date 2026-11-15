import { useMemo, useReducer, useState } from "react";
import type { FilterRequest } from "../src/types";
import {
  applyKeybindingOverrides,
  type KeybindingOverrides,
} from "./keymap";
import { CommandToolbar } from "./CommandToolbar";
import { buildToolbar } from "../src/toolbar";
import { appReducer, createInitialAppState } from "./state/app-state";
import { splitGlobLines } from "./state/selection";
import { useRepositoryData } from "./hooks/useRepositoryData";
import { useChangeSet } from "./hooks/useChangeSet";
import { useSearch } from "./hooks/useSearch";
import { useActions } from "./hooks/useActions";
import { useKeyboard } from "./hooks/useKeyboard";
import { useAppEffects } from "./hooks/useAppEffects";
import { TopBar } from "./panels/TopBar";
import { Sidebar } from "./panels/Sidebar";
import { DiffPane } from "./panels/DiffPane";
import { StatusBar } from "./panels/StatusBar";
import { AppDialogs } from "./panels/AppDialogs";

export function App() {
  const [state, appDispatch] = useReducer(
    appReducer,
    undefined,
    createInitialAppState,
  );
  const {
    selection,
    focusedPanel,
    worktreeCursor,
    branchCursor,
    commitCursor,
    fileCursor,
    selectedPath,
    filtersOpen,
    disabledExtensions,
    includeGlobs,
    excludeGlobs,
    hideNoise,
    fullFile,
    helpOpen,
    diffView,
    theme,
    timeWindowOpen,
    timeWindowDialogMode,
    searchQuery,
    searchOpen,
    matchIndex,
    agentFilter,
  } = state;

  const [keybindingOverrides, setKeybindingOverrides] =
    useState<KeybindingOverrides>({});
  const keymap = useMemo(
    () => applyKeybindingOverrides(keybindingOverrides),
    [keybindingOverrides],
  );
  const [noisePatterns, setNoisePatterns] = useState<readonly string[]>([]);

  const repository = useRepositoryData();
  const {
    allCommits,
    worktrees,
    branches,
    baseBranch,
    selectedWorktreePath,
    refreshVersion,
  } = repository;

  const agentNames = [
    ...new Set(
      allCommits
        .map((commit) => commit.agent)
        .filter((agent): agent is string => agent !== null),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const commits = agentFilter
    ? allCommits.filter((commit) => commit.agent === agentFilter)
    : allCommits;

  const filterRequest = useMemo<FilterRequest>(
    () => ({
      disabledExtensions,
      includeGlobs: splitGlobLines(includeGlobs),
      excludeGlobs: splitGlobLines(excludeGlobs),
      hideNoise,
    }),
    [disabledExtensions, excludeGlobs, hideNoise, includeGlobs],
  );
  const selectionIsStack =
    (selection.kind === "commits" || selection.kind === "time-window") &&
    selection.mode === "stack";
  const listFilterRequest = useMemo<FilterRequest>(
    () =>
      fullFile && selectionIsStack
        ? { ...filterRequest, fullContext: true }
        : filterRequest,
    [filterRequest, fullFile, selectionIsStack],
  );

  const changeSetState = useChangeSet({
    selection,
    selectedPath,
    selectedWorktreePath,
    agentFilter,
    fullFile,
    filterRequest,
    listFilterRequest,
    refreshVersion,
    appDispatch,
    setPending: repository.setPending,
    setWorktree: repository.setWorktree,
    setRepositoryChanged: repository.setRepositoryChanged,
    setRefreshNotice: repository.setRefreshNotice,
    setSelectedWorktreePath: repository.setSelectedWorktreePath,
  });
  const {
    changeSet,
    setChangeSet,
    loading,
    error,
    markError,
    setMarkError,
    diffError,
    setDiffError,
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
  } = changeSetState;

  useAppEffects({
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
  });

  const selectedWorktree =
    selection.kind === "pending"
      ? (selectedWorktreePath ??
        repository.pending?.worktree.path ??
        changeSet?.worktree.path ??
        worktrees.find((worktree) => worktree.current)?.path ??
        repository.worktree?.path ??
        null)
      : null;

  const search = useSearch({
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
  });

  const actions = useActions({
    state,
    appDispatch,
    files,
    fileContext,
    setChangeSet,
    setDiffError,
    setMarkError,
    commits,
    allCommits,
    agentNames,
    branches,
    baseBranch,
    worktrees,
    searchFiles: search.searchFiles,
    searchMatches: search.searchMatches,
    currentDiffFileKey: search.currentDiffFileKey,
    currentHunkLocation: search.currentHunkLocation,
    jumpToMatch: search.jumpToMatch,
    jumpToTarget: search.jumpToTarget,
    clearSearch: search.clearSearch,
    refreshRepository: repository.refreshRepository,
    markPreserve,
    setSelectedWorktreePath: repository.setSelectedWorktreePath,
    diffRef,
  });

  useKeyboard({
    keymap,
    dispatch: actions.dispatch,
    dispatchTimeWindow: actions.dispatchTimeWindow,
    clearSearch: search.clearSearch,
    commitSearch: search.commitSearch,
    focusedPanel,
    helpOpen,
    timeWindowOpen,
    timeWindowDialogMode,
    filtersOpen,
    searchOpen,
    searchActive: search.searchActive,
  });

  const toolbarGroups = useMemo(() => {
    const selectedFile =
      files.find((file) => file.path === selectedPath) ?? null;
    const activeFile = files[fileCursor] ?? selectedFile;

    return buildToolbar(keymap, {
      hasFile: files.length > 0,
      selectedFileCollapsed: activeFile?.collapsed === true,
      hasCommit: commits.length > 0,
      canToggleMode:
        (selection.kind === "commits" || selection.kind === "time-window") &&
        selection.contiguous,
      mode:
        selection.kind === "commits" || selection.kind === "time-window"
          ? selection.mode
          : null,
      agentFilter,
      hasAgentCommits: agentNames.length > 0,
      searchActive: search.searchActive,
      searchMatchCount: search.searchMatches.length,
      diffView,
      fullFile,
      theme,
      hideNoise,
      filtersOpen,
      repositoryChanged: repository.repositoryChanged,
    });
  }, [
    agentFilter,
    agentNames.length,
    commits.length,
    diffView,
    files,
    fileCursor,
    filtersOpen,
    fullFile,
    hideNoise,
    keymap,
    repository.repositoryChanged,
    search.searchActive,
    search.searchMatches.length,
    selectedPath,
    selection,
    theme,
  ]);

  return (
    <div className="app">
      <TopBar
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        onSearchChange={search.updateSearchQuery}
        worktreePath={repository.worktree?.path}
        selection={selection}
      />

      <CommandToolbar
        groups={toolbarGroups}
        onAction={actions.runToolbarAction}
      />

      {repository.repositoryChanged ? (
        <div
          className="repository-banner"
          data-testid="repository-banner"
          role="status"
        >
          Repository changed — press <kbd>r</kbd> to refresh
        </div>
      ) : null}

      {repository.refreshNotice ? (
        <div
          className="repository-notice"
          data-testid="refresh-notice"
          role="status"
        >
          {repository.refreshNotice}
        </div>
      ) : null}

      <div className="workspace">
        <Sidebar
          selection={selection}
          focusedPanel={focusedPanel}
          worktrees={worktrees}
          worktreesError={repository.worktreesError}
          selectedWorktree={selectedWorktree}
          worktreeCursor={worktreeCursor}
          onSelectWorktree={(index, path) => {
            repository.setSelectedWorktreePath(path);
            appDispatch({ type: "select-worktree", index });
          }}
          branches={branches}
          branchesError={repository.branchesError}
          baseBranch={baseBranch}
          branchCursor={branchCursor}
          onSelectBranch={(index, branch) =>
            appDispatch({ type: "select-branch", index, branch, baseBranch })
          }
          commits={commits}
          commitsError={repository.commitsError}
          agentFilter={agentFilter}
          commitCursor={commitCursor}
          onSelectCommit={(index, commit) =>
            appDispatch({ type: "select-commit", index, commit })
          }
          files={files}
          loading={loading}
          error={error}
          isStack={isStack}
          commitGroups={commitGroups}
          hiddenFiles={hiddenFiles}
          fileCursor={fileCursor}
          selectedPath={selectedPath}
          stackFileIndex={stackFileIndex}
          onSelectFile={(index, path) =>
            appDispatch({ type: "select-file", index, path })
          }
        />

        <DiffPane
          focusedPanel={focusedPanel}
          diffRef={diffRef}
          isStack={isStack}
          commitGroups={commitGroups}
          hiddenFiles={hiddenFiles}
          selection={selection}
          loading={loading}
          error={error}
          files={files}
          selected={selected}
          fileContext={fileContext}
          diffView={diffView}
          searchMatches={search.searchMatches}
          currentMatch={search.currentMatch}
          jump={search.jump}
          changeOverview={search.changeOverview}
        />
      </div>

      <StatusBar
        selection={selection}
        changeSet={changeSet}
        files={files}
        diffView={diffView}
        fullFile={fullFile}
        filterRequest={filterRequest}
        hiddenFiles={hiddenFiles}
        searchQuery={searchQuery}
        searchMatchCount={search.searchMatches.length}
        matchIndex={matchIndex}
        collapsedSearchFiles={search.collapsedSearchFiles}
        markError={markError}
        diffError={diffError}
        agentFilter={agentFilter}
        baseBranch={baseBranch}
        worktree={repository.worktree}
      />

      <AppDialogs
        state={state}
        appDispatch={appDispatch}
        keymap={keymap}
        noisePatterns={noisePatterns}
        availableExtensions={filterInfo?.availableExtensions ?? []}
        actions={actions}
      />
    </div>
  );
}
