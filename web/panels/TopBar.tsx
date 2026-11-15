import type { Selection } from "../../shared/types";
import { selectionBadge, selectionLabel } from "../state/selection";

export function TopBar({
  searchOpen,
  searchQuery,
  onSearchChange,
  worktreePath,
  selection,
}: {
  readonly searchOpen: boolean;
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly worktreePath: string | undefined;
  readonly selection: Selection;
}) {
  return (
    <header className="top-bar">
      <span className="brand">diff4ac</span>
      {searchOpen ? (
        <span className="search-prompt">
          <span className="search-slash">/</span>
          <input
            className="search-input"
            data-testid="search-input"
            type="text"
            value={searchQuery}
            autoFocus
            aria-label="Search Change Set"
            placeholder="search this Change Set"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </span>
      ) : null}
      <span className="top-bar-path" title={worktreePath}>
        {worktreePath ?? ""}
      </span>
      <span className="top-bar-mode" title={selectionLabel(selection)}>
        {selectionBadge(selection)}
      </span>
    </header>
  );
}
