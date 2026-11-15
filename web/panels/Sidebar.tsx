import type {
  BaseBranch,
  BranchSummary,
  ChangeFile,
  CommitChangeGroup,
  CommitSummary,
  FilesView,
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
import type { FileTreeModel, FileTreeSection } from "../state/file-tree";
import { FolderTree } from "./FolderTree";
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
  readonly hasMoreCommits: boolean;
  readonly loadingMoreCommits: boolean;
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
  readonly filesView: FilesView;
  readonly fileTree: FileTreeModel;
  readonly stackFileIndex: Map<string, number>;
  readonly onToggleFolder: (index: number, key: string) => void;
  readonly onSelectFile: (index: number, path: string, commitHash?: string) => void;
}

function sectionFiles(
  section: FileTreeSection,
  groups: readonly CommitChangeGroup[],
): readonly { readonly file: ChangeFile; readonly commitHash: string }[] {
  const group = groups.find((candidate) => candidate.commit.hash === section.key);
  if (!group) {
    return [];
  }
  return group.files.map((file) => ({
    file,
    commitHash: group.commit.hash,
  }));
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
  hasMoreCommits,
  loadingMoreCommits,
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
  filesView,
  fileTree,
  stackFileIndex,
  onToggleFolder,
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
            {hasMoreCommits ? (
              <div className="commit-more" data-testid="commit-more">
                {loadingMoreCommits ? "loading more…" : "… more"}
              </div>
            ) : null}
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
              {fileTree.sections.map((section) => (
                <section
                  className="stack-file-group"
                  key={section.key}
                >
                  <div
                    className="stack-file-heading"
                    title={section.heading?.message}
                  >
                    <span className="commit-hash">
                      {section.heading?.shortHash}
                    </span>
                    <span className="stack-file-message">
                      {section.heading?.message}
                    </span>
                  </div>
                  {section.nodes.length === 0 ? (
                    <div className="placeholder">No file changes.</div>
                  ) : filesView === "tree" ? (
                    <FolderTree
                      nodes={section.nodes}
                      expanded={fileTree.expanded}
                      cursorIndex={fileCursor - section.startIndex}
                      onToggleFolder={(folder, rowIndex) =>
                        onToggleFolder(
                          section.startIndex + rowIndex,
                          folder.key,
                        )
                      }
                      renderFile={(file, renderState) => {
                        const payload = file.payload;
                        const globalIndex =
                          section.startIndex + renderState.rowIndex;
                        return (
                          <FileRow
                            file={payload.file}
                            selected={payload.file.path === selectedPath}
                            cursor={renderState.cursor}
                            depth={renderState.depth}
                            onSelect={() => {
                              onSelectFile(
                                globalIndex,
                                payload.file.path,
                                payload.commitHash ?? undefined,
                              );
                              if (payload.commitHash) {
                                document
                                  .getElementById(
                                    stackFileId(
                                      payload.commitHash,
                                      payload.file.path,
                                    ),
                                  )
                                  ?.scrollIntoView({ block: "start" });
                              }
                            }}
                          />
                        );
                      }}
                    />
                  ) : (
                    <ul className="file-list">
                      {section.nodes.length === 0
                        ? null
                        : sectionFiles(section, commitGroups).map((entry) => {
                            const file = entry.file;
                            const key = `${entry.commitHash}:${file.path}`;
                            const index = stackFileIndex.get(key) ?? 0;
                            return (
                              <FileRow
                                key={key}
                                file={file}
                                selected={file.path === selectedPath}
                                cursor={fileCursor === index}
                                onSelect={() => {
                                  onSelectFile(
                                    index,
                                    file.path,
                                    entry.commitHash,
                                  );
                                  if (entry.commitHash) {
                                    document
                                      .getElementById(
                                        stackFileId(
                                          entry.commitHash,
                                          file.path,
                                        ),
                                      )
                                      ?.scrollIntoView({ block: "start" });
                                  }
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
        ) : filesView === "tree" ? (
          <FolderTree
            nodes={fileTree.sections[0]?.nodes ?? []}
            expanded={fileTree.expanded}
            cursorIndex={fileCursor}
            onToggleFolder={(folder, rowIndex) =>
              onToggleFolder(rowIndex, folder.key)
            }
            renderFile={(file, renderState) => {
              const payload = file.payload;
              return (
                <FileRow
                  file={payload.file}
                  selected={payload.file.path === selectedPath}
                  cursor={renderState.cursor}
                  depth={renderState.depth}
                  onSelect={() =>
                    onSelectFile(renderState.rowIndex, payload.file.path)
                  }
                />
              );
            }}
          />
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
