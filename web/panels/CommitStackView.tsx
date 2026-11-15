import {
  countDiffRows,
  DiffView,
  VIRTUAL_ROW_THRESHOLD,
  type DiffJump,
} from "../DiffView";
import type { DiffViewMode } from "../../shared/diff/rows";
import type { FileRequestContext } from "../api";
import type { CommitChangeGroup } from "../../shared/types";
import type { SearchMatch } from "../../shared/diff/search";
import { stackFileId, stackFileKey } from "../state/selection";

export function CommitStackView({
  groups,
  context,
  viewMode,
  searchMatches,
  currentMatch,
  jump,
}: {
  readonly groups: readonly CommitChangeGroup[];
  readonly context: FileRequestContext;
  readonly viewMode: DiffViewMode;
  readonly searchMatches: readonly SearchMatch[];
  readonly currentMatch: SearchMatch | null;
  readonly jump: DiffJump | null;
}) {
  if (groups.length === 0) {
    return <div className="diff-empty">No commit changes.</div>;
  }

  const forceVirtual =
    countDiffRows(groups.flatMap((group) => group.files)) >
    VIRTUAL_ROW_THRESHOLD;

  return (
    <div className="commit-stack">
      {groups.map((group) => (
        <section className="commit-stack-group" key={group.commit.hash}>
          <header className="commit-stack-heading">
            <span className="commit-hash">{group.commit.shortHash}</span>
            <span className="commit-stack-message">{group.commit.message}</span>
            <span className="file-counts">
              <span className="muted">{group.totals.files} files</span>
              <span className="add">+{group.totals.additions}</span>
              <span className="del">−{group.totals.deletions}</span>
            </span>
          </header>
          {group.files.length === 0 ? (
            <div className="diff-empty">No file changes in this commit.</div>
          ) : (
            group.files.map((file) => {
              const key = stackFileKey(group.commit.hash, file.path);
              return (
                <DiffView
                  key={key}
                  id={stackFileId(group.commit.hash, file.path)}
                  fileKey={key}
                  file={file}
                  context={context}
                  viewMode={viewMode}
                  forceVirtual={forceVirtual}
                  searchMatches={searchMatches.filter(
                    (match) => match.fileKey === key,
                  )}
                  currentMatch={currentMatch}
                  jump={jump}
                />
              );
            })
          )}
        </section>
      ))}
    </div>
  );
}
