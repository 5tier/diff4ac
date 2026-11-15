import type { MutableRefObject } from "react";
import type {
  ChangeFile,
  CommitChangeGroup,
  Selection,
} from "../../src/types";
import type { DiffViewMode } from "../../src/diff/rows";
import type { SearchMatch } from "../../src/diff/search";
import type { FileRequestContext } from "../api";
import type { DiffJump } from "../DiffView";
import { DiffView } from "../DiffView";
import { OverviewRuler } from "../OverviewRuler";
import type { buildChangeOverview } from "../../src/diff/overview";
import type { PanelId } from "../keymap";
import { emptyFilesMessage, hiddenFilesLabel } from "../state/selection";
import { CommitStackView } from "./CommitStackView";

export interface DiffPaneProps {
  readonly focusedPanel: PanelId;
  readonly diffRef: MutableRefObject<HTMLElement | null>;
  readonly isStack: boolean;
  readonly commitGroups: readonly CommitChangeGroup[];
  readonly hiddenFiles: number;
  readonly selection: Selection;
  readonly loading: boolean;
  readonly error: string | null;
  readonly files: readonly ChangeFile[];
  readonly selected: ChangeFile | null;
  readonly fileContext: FileRequestContext;
  readonly diffView: DiffViewMode;
  readonly searchMatches: readonly SearchMatch[];
  readonly currentMatch: SearchMatch | null;
  readonly jump: DiffJump | null;
  readonly changeOverview: ReturnType<typeof buildChangeOverview>;
}

export function DiffPane({
  focusedPanel,
  diffRef,
  isStack,
  commitGroups,
  hiddenFiles,
  selection,
  loading,
  error,
  files,
  selected,
  fileContext,
  diffView,
  searchMatches,
  currentMatch,
  jump,
  changeOverview,
}: DiffPaneProps) {
  return (
    <div className="diff-shell">
      <main
        ref={diffRef}
        className={
          focusedPanel === "diff"
            ? "diff-pane diff-pane-focused"
            : "diff-pane"
        }
        data-panel="diff"
        data-focused={focusedPanel === "diff" ? "true" : "false"}
      >
        {isStack ? (
          commitGroups.length === 0 ? (
            <div className="diff-empty">
              {hiddenFiles > 0
                ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
                : emptyFilesMessage(selection)}
            </div>
          ) : (
            <CommitStackView
              groups={commitGroups}
              context={fileContext}
              viewMode={diffView}
              searchMatches={searchMatches}
              currentMatch={currentMatch}
              jump={jump}
            />
          )
        ) : selected ? (
          <DiffView
            fileKey={selected.path}
            file={selected}
            context={fileContext}
            viewMode={diffView}
            searchMatches={searchMatches.filter(
              (match) => match.fileKey === selected.path,
            )}
            currentMatch={currentMatch}
            jump={jump}
          />
        ) : !loading && !error && files.length === 0 ? (
          <div className="diff-empty">
            {hiddenFiles > 0
              ? `${hiddenFilesLabel(hiddenFiles)} by Filters.`
              : emptyFilesMessage(selection)}
          </div>
        ) : (
          <div className="diff-empty">
            {error
              ? "Could not load the Change Set."
              : "Select a file to see its unified diff."}
          </div>
        )}
      </main>
      <OverviewRuler overview={changeOverview} pane={diffRef} />
    </div>
  );
}
