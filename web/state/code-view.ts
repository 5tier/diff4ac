import type {
  ChangeFile,
  FileStatus,
  SnapshotSide,
  SnapshotTreeEntry,
  SnapshotChangeStatus,
} from "../../shared/types";
import type {
  FolderTreeNode,
} from "../../shared/folder-tree";
import {
  buildDiffRows,
  type DiffViewMode,
} from "../../shared/diff/rows";
import { measureDiffLayout } from "../diff-layout";
import { rowAtOffset } from "../../shared/diff/layout";

export interface CodeTreePayload {
  readonly entry: SnapshotTreeEntry;
}

export interface CodeSearchMatch {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

export interface CodeGap {
  readonly line: number;
  readonly kind: "add" | "delete";
}

export interface CodeMarks {
  readonly addLines: ReadonlySet<number>;
  readonly modifiedLines: ReadonlySet<number>;
  readonly removedLines: ReadonlySet<number>;
  readonly gaps: readonly CodeGap[];
}

export function ancestorDirs(path: string): readonly string[] {
  const segments = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let index = 1; index < segments.length; index++) {
    dirs.push(segments.slice(0, index).join("/"));
  }
  return dirs;
}

function folderCounts(
  nodes: readonly FolderTreeNode<CodeTreePayload>[],
): { files: number } {
  let files = 0;
  for (const node of nodes) {
    files += node.kind === "file" ? 1 : folderCounts(node.children).files;
  }
  return { files };
}

/** Build lazy FolderTree nodes from the folders loaded so far. */
export function snapshotTreeNodes(
  entriesByDir: ReadonlyMap<string, readonly SnapshotTreeEntry[]>,
  dir = "",
): readonly FolderTreeNode<CodeTreePayload>[] {
  const entries = entriesByDir.get(dir) ?? [];
  return entries.map((entry) => {
    if (entry.kind === "dir") {
      const children = entriesByDir.has(entry.path)
        ? snapshotTreeNodes(entriesByDir, entry.path)
        : [];
      return {
        kind: "folder",
        key: entry.path,
        name: entry.name,
        path: entry.path,
        children,
        childrenLoaded: entriesByDir.has(entry.path),
        ...(() => {
          const counts = folderCounts(children);
          return {
            fileCount: counts.files,
            additions: 0,
            deletions: 0,
            reviewedCount: 0,
          };
        })(),
      };
    }
    return {
      kind: "file",
      key: entry.path,
      name: entry.name,
      path: entry.path,
      payload: { entry },
    };
  });
}

export function statusLabel(
  status: SnapshotChangeStatus | FileStatus | undefined,
): string {
  switch (status) {
    case "added":
    case "untracked":
    case "copied":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "modified":
    case "typechanged":
    case "unmerged":
      return "M";
    default:
      return "";
  }
}

export function changeFileForPath(
  files: readonly ChangeFile[],
  path: string,
  side: SnapshotSide,
): ChangeFile | null {
  return (
    files.find((file) =>
      side === "before"
        ? file.oldPath === path || file.path === path
        : file.path === path || file.oldPath === path,
    ) ?? null
  );
}

export function codeSearchMatches(
  text: string | undefined,
  query: string,
): readonly CodeSearchMatch[] {
  if (!text || query === "") {
    return [];
  }
  const needle = query.toLowerCase();
  const matches: CodeSearchMatch[] = [];
  text.split("\n").forEach((line, index) => {
    const haystack = line.toLowerCase();
    let from = 0;
    for (;;) {
      const start = haystack.indexOf(needle, from);
      if (start === -1) {
        break;
      }
      matches.push({ line: index + 1, start, end: start + query.length });
      from = start + Math.max(1, query.length);
    }
  });
  return matches;
}

export function topNewLineForDiff(
  pane: HTMLElement | null,
  file: ChangeFile,
  viewMode: DiffViewMode,
): number {
  if (!pane) {
    return 1;
  }
  const layout = measureDiffLayout(pane);
  const entry = layout.files.get(file.path);
  if (!entry) {
    return 1;
  }
  const row = rowAtOffset(entry, pane.scrollTop + layout.stickyHeight);
  const rows = buildDiffRows(file.hunks, viewMode);
  for (let index = row; index < rows.length; index++) {
    const candidate = rows[index];
    if (candidate?.kind === "line" && candidate.newLine !== null) {
      return candidate.newLine;
    }
    if (candidate?.kind === "split" && candidate.right?.lineNumber != null) {
      return candidate.right.lineNumber;
    }
  }
  return 1;
}

export function markSets(
  added: readonly { start: number; end: number }[],
  modified: readonly { start: number; end: number }[],
  removed: readonly { start: number; end: number }[],
  gaps: readonly CodeGap[],
): CodeMarks {
  const addLines = new Set<number>();
  const modifiedLines = new Set<number>();
  const removedLines = new Set<number>();
  for (const [ranges, target] of [
    [added, addLines],
    [modified, modifiedLines],
    [removed, removedLines],
  ] as const) {
    for (const range of ranges) {
      for (let line = range.start; line <= range.end; line++) {
        target.add(line);
      }
    }
  }
  return { addLines, modifiedLines, removedLines, gaps };
}
