import type {
  BaseBranch,
  BranchSummary,
  ChangeFile,
  CommitChangeGroup,
  CommitSummary,
  Selection,
  WorktreeSummary,
} from "../../shared/types";
import type { PanelId } from "../../shared/keymap";
import {
  emptyFilesMessage,
  hiddenFilesLabel,
  selectionIncludesCommit,
  stackFileId,
} from "../state/selection";
import { Panel } from "./Panel";
import { BranchRow, CommitRow, FileRow, WorktreeRow } from "./Rows";

export interface SidebarProps {
  readonly selection: Selection;
  readonly focusedPanel: PanelId;
  readonly worktrees: readonly WorktreeSummary[];
  readonly worktreesError: string | null;
  readonly selectedWorktree: string | null;
  readonly worktreeCursor: number;
  readonly onSelectWorktree: (index: number, path: string) => void;
  readonly branches: readonly BranchSummary[];
  readonly branchesError: string | null;
  readonly baseBranch: BaseBranch | null;
  readonly branchCursor: number;
  readonly onSelectBranch: (index: number, branch: BranchSummary) => void;
  readonly commits: readonly CommitSummary[];
  readonly commitsError: string | null;
  readonly agentFilter: string | null;
  readonly commitCursor: number;
  readonly onSelectCommit: (index: number, commit: CommitSummary) => void;
  readonly files: readonly ChangeFile[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly isStack: boolean;
  readonly commitGroups: readonly CommitChangeGroup[];
  readonly hiddenFiles: number;
  readonly fileCursor: number;
  readonly selectedPath: string | null;
  readonly stackFileIndex: Map<string, number>;
  readonly onSelectFile: (index: number, path: string, commitHash?: string) => void;
}

export function Sidebar({
  selection,
  focusedPanel,
  worktrees,
  worktreesError,
  selectedWorktree,
  worktreeCursor,
  onSelectWorktree,
  branches,
  branchesError,
  baseBranch,
  branchCursor,
  onSelectBranch,
  commits,
  commitsError,
  agentFilter,
  commitCursor,
  onSelectCommit,
  files,
  loading,
  error,
  isStack,
  commitGroups,
  hiddenFiles,
  fileCursor,
  selectedPath,
  stackFileIndex,
  onSelectFile,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <Panel
        id="worktrees"
        title="Worktrees"
        count={worktrees.length}
        focused={focusedPanel === "worktrees"}
        cursor={worktreeCursor}
        className="panel-worktrees"
      >
        {worktreesError ? (
          <div className="error">{worktreesError}</div>
        ) : worktrees.length === 0 ? (
          <div className="placeholder">Loading Worktrees…</div>
        ) : (
          <ul className="worktree-list">
            {worktrees.map((worktree, index) => (
              <WorktreeRow
                key={worktree.path}
                worktree={worktree}
                selected={selectedWorktree === worktree.path}
                cursor={worktreeCursor === index}
                onSelect={() => onSelectWorktree(index, worktree.path)}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        id="branches"
        title="Branches"
        count={branches.length}
        focused={focusedPanel === "branches"}
        cursor={branchCursor}
        className="panel-branches"
      >
        {branchesError ? (
          <div className="error">{branchesError}</div>
        ) : branches.length === 0 ? (
          <div className="placeholder">No local branches.</div>
        ) : (
          <>
            {baseBranch ? null : (
              <div className="placeholder">
                Base Branch not detected (no origin/HEAD, main or master).
              </div>
            )}
            <ul className="branch-list">
              {branches.map((branch, index) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  cursor={branchCursor === index}
                  selected={
                    selection.kind === "branch" &&
                    selection.branch.name === branch.name
                  }
                  disabled={baseBranch === null}
                  onSelect={() => onSelectBranch(index, branch)}
                />
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel
        id="commits"
        title="Commits"
        count={commits.length}
        focused={focusedPanel === "commits"}
        cursor={commitCursor}
        className="panel-commits"
      >
        {commitsError ? (
          <div className="error">{commitsError}</div>
        ) : commits.length === 0 ? (
          <div className="placeholder">
            {agentFilter
              ? `No ${agentFilter} commits on this branch.`
              : "No commits on this branch yet."}
          </div>
        ) : (
          <>
            {(selection.kind === "commits" ||
              selection.kind === "time-window") &&
            !selection.contiguous ? (
              <div className="selection-note">
                Non-contiguous Selection: Commit Stack only.
              </div>
            ) : null}
            <ul className="commit-list">
              {commits.map((commit, index) => (
                <CommitRow
                  key={commit.hash}
                  commit={commit}
                  selected={selectionIncludesCommit(
                    selection,
                    commit.hash,
                  )}
                  cursor={commitCursor === index}
                  onSelect={() => onSelectCommit(index, commit)}
                />
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel
        id="files"
        title="Files"
        count={files.length}
        grow
        focused={focusedPanel === "files"}
        cursor={fileCursor}
      >
        {loading ? (
          <div className="placeholder">Loading Change Set…</div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : isStack ? (
          commitGroups.length === 0 ? (
            <div className="placeholder">
              {hiddenFiles > 0
                ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
                : emptyFilesMessage(selection)}
            </div>
          ) : (
            <div className="stack-file-list">
              {commitGroups.map((group) => (
                <section className="stack-file-group" key={group.commit.hash}>
                  <div
                    className="stack-file-heading"
                    title={group.commit.message}
                  >
                    <span className="commit-hash">
                      {group.commit.shortHash}
                    </span>
                    <span className="stack-file-message">
                      {group.commit.message}
                    </span>
                  </div>
                  {group.files.length === 0 ? (
                    <div className="placeholder">No file changes.</div>
                  ) : (
                    <ul className="file-list">
                      {group.files.map((file) => {
                        const key = `${group.commit.hash}:${file.path}`;
                        const index = stackFileIndex.get(key) ?? 0;
                        return (
                          <FileRow
                            key={key}
                            file={file}
                            selected={file.path === selectedPath}
                            cursor={fileCursor === index}
                            onSelect={() => {
                              onSelectFile(index, file.path, group.commit.hash);
                              document
                                .getElementById(
                                  stackFileId(group.commit.hash, file.path),
                                )
                                ?.scrollIntoView({ block: "start" });
                            }}
                          />
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )
        ) : files.length === 0 ? (
          <div className="placeholder">
            {hiddenFiles > 0
              ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
              : emptyFilesMessage(selection)}
          </div>
        ) : (
          <ul className="file-list">
            {files.map((file, index) => (
              <FileRow
                key={file.path}
                file={file}
                selected={file.path === selectedPath}
                cursor={fileCursor === index}
                onSelect={() => onSelectFile(index, file.path)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </aside>
  );
}
