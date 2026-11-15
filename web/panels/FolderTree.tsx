import { Fragment, type ReactNode } from "react";
import {
  visibleFolderTreeRows,
  type FolderTreeFile,
  type FolderTreeFolder,
  type FolderTreeNode,
} from "../../shared/folder-tree";

export interface FolderTreeFileRenderState {
  readonly depth: number;
  readonly rowIndex: number;
  readonly cursor: boolean;
}

export interface FolderTreeProps<T> {
  readonly nodes: readonly FolderTreeNode<T>[];
  readonly expanded: ReadonlySet<string>;
  readonly cursorIndex: number;
  readonly onToggleFolder: (
    folder: FolderTreeFolder<T>,
    rowIndex: number,
  ) => void;
  readonly renderFile: (
    file: FolderTreeFile<T>,
    state: FolderTreeFileRenderState,
  ) => ReactNode;
}

function indent(depth: number): string {
  return `${8 + depth * 14}px`;
}

export function FolderTree<T>({
  nodes,
  expanded,
  cursorIndex,
  onToggleFolder,
  renderFile,
}: FolderTreeProps<T>) {
  const rows = visibleFolderTreeRows(nodes, expanded);

  return (
    <ul className="folder-tree">
      {rows.map((row, rowIndex) => {
        if (row.kind === "file") {
          return (
            <Fragment key={row.node.key}>
              {renderFile(row.node, {
                depth: row.depth,
                rowIndex,
                cursor: rowIndex === cursorIndex,
              })}
            </Fragment>
          );
        }

        const isExpanded = expanded.has(row.node.key);
        return (
          <li key={row.node.key}>
            <button
              type="button"
              className={[
                "folder-row",
                rowIndex === cursorIndex ? "folder-row-cursor" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ paddingLeft: indent(row.depth) }}
              aria-expanded={isExpanded}
              data-folder-path={row.node.path}
              onClick={() => onToggleFolder(row.node, rowIndex)}
            >
              <span className="folder-chevron" aria-hidden="true">
                {isExpanded ? "▾" : "▸"}
              </span>
              <span className="folder-name">{row.node.name}</span>
              <span className="folder-counts">
                <span className="muted">{row.node.fileCount} files</span>
                <span className="add">+{row.node.additions}</span>
                <span className="del">−{row.node.deletions}</span>
                <span className="folder-review">
                  {row.node.reviewedCount} reviewed
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
