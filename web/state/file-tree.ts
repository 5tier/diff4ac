import type {
  ChangeFile,
  CommitChangeGroup,
  FilesView,
} from "../../shared/types";
import type { PanelId } from "../../shared/keymap";
import type { SearchFile } from "../../shared/diff/search";
import {
  nextFileTarget,
  type FileTarget,
} from "../../shared/diff/navigation";
import type { AppAction } from "./app-actions";
import {
  buildFolderTree,
  folderTreeAncestors,
  folderTreeFileKeys,
  folderTreeFolderKeys,
  visibleFolderTreeFileKeys,
  visibleFolderTreeRows,
  type FolderTreeFileRow,
  type FolderTreeNode,
  type FolderTreeRow,
} from "../../shared/folder-tree";
import { stackFileKey } from "./selection";

export interface FileTreePayload {
  readonly file: ChangeFile;
  readonly fileKey: string;
  readonly commitHash: string | null;
}

export interface FileTreeHeading {
  readonly shortHash: string;
  readonly message: string;
}

export interface FileTreeSection {
  readonly key: string;
  readonly heading: FileTreeHeading | null;
  readonly nodes: readonly FolderTreeNode<FileTreePayload>[];
  readonly rows: readonly FolderTreeRow<FileTreePayload>[];
  readonly startIndex: number;
}

export interface FileTreeModel {
  readonly sections: readonly FileTreeSection[];
  readonly rows: readonly FolderTreeRow<FileTreePayload>[];
  readonly expanded: ReadonlySet<string>;
  readonly flatFileKeys: readonly string[];
  readonly visibleFileKeys: readonly string[];
}

interface SectionInput {
  readonly key: string;
  readonly heading: FileTreeHeading | null;
  readonly prefix: string;
  readonly files: readonly ChangeFile[];
  readonly commitHash: string | null;
}

export function buildFileTreeModel(
  files: readonly ChangeFile[],
  commitGroups: readonly CommitChangeGroup[],
  isStack: boolean,
  collapsedFolders: readonly string[],
): FileTreeModel {
  const inputs: SectionInput[] = isStack
    ? commitGroups.map((group) => ({
        key: group.commit.hash,
        heading: {
          shortHash: group.commit.shortHash,
          message: group.commit.message,
        },
        prefix: `${group.commit.hash}:`,
        files: group.files,
        commitHash: group.commit.hash,
      }))
    : [
        {
          key: "all",
          heading: null,
          prefix: "",
          files,
          commitHash: null,
        },
      ];

  const collapsed = new Set(collapsedFolders);
  const sections: FileTreeSection[] = [];
  const allFolderKeys: string[] = [];
  const rows: FolderTreeRow<FileTreePayload>[] = [];
  let startIndex = 0;

  for (const input of inputs) {
    const nodes = buildFolderTree(
      input.files.map((file) => {
        const fileKey = input.commitHash
          ? stackFileKey(input.commitHash, file.path)
          : file.path;
        return {
          path: file.path,
          key: fileKey,
          payload: { file, fileKey, commitHash: input.commitHash },
          additions: file.additions,
          deletions: file.deletions,
          reviewed: file.reviewed === true,
        };
      }),
      { keyPrefix: input.prefix },
    );
    const folderKeys = folderTreeFolderKeys(nodes);
    allFolderKeys.push(...folderKeys);
    const sectionRows = visibleFolderTreeRows(
      nodes,
      new Set(folderKeys.filter((key) => !collapsed.has(key))),
    );
    sections.push({
      key: input.key,
      heading: input.heading,
      nodes,
      rows: sectionRows,
      startIndex,
    });
    rows.push(...sectionRows);
    startIndex += sectionRows.length;
  }

  return {
    sections,
    rows,
    expanded: new Set(allFolderKeys.filter((key) => !collapsed.has(key))),
    flatFileKeys: flatFileKeys(files, commitGroups, isStack),
    visibleFileKeys: visibleFolderTreeFileKeys(rows),
  };
}

function flatFileKeys(
  files: readonly ChangeFile[],
  commitGroups: readonly CommitChangeGroup[],
  isStack: boolean,
): readonly string[] {
  if (!isStack) {
    return files.map((file) => file.path);
  }
  return commitGroups.flatMap((group) =>
    group.files.map((file) => stackFileKey(group.commit.hash, file.path)),
  );
}

export function activeTreeFileRow(
  model: FileTreeModel,
  fileCursor: number,
): FolderTreeFileRow<FileTreePayload> | null {
  const row = model.rows[fileCursor];
  return row?.kind === "file" ? row : null;
}

export function activeTreeRow(
  model: FileTreeModel,
  fileCursor: number,
): FolderTreeRow<FileTreePayload> | null {
  return model.rows[fileCursor] ?? null;
}

/** The file key the cursor points at, falling back to the selected path. */
export function fileKeyAtCursor(
  model: FileTreeModel,
  view: FilesView,
  fileCursor: number,
  selectedPath: string | null,
): string | null {
  if (view === "list") {
    return (
      model.flatFileKeys[fileCursor] ??
      model.flatFileKeys.find(
        (key) => key === selectedPath || key.endsWith(`:${selectedPath}`),
      ) ??
      null
    );
  }

  const row = model.rows[fileCursor];
  if (row?.kind === "file") {
    return row.node.key;
  }
  const selected = model.rows.find(
    (candidate) =>
      candidate.kind === "file" &&
      candidate.node.payload.file.path === selectedPath,
  );
  if (selected?.kind === "file") {
    return selected.node.key;
  }
  return (
    model.flatFileKeys.find(
      (key) => key === selectedPath || key.endsWith(`:${selectedPath}`),
    ) ?? null
  );
}

export function cursorForView(
  model: FileTreeModel,
  view: FilesView,
  fileKey: string | null,
): number {
  if (!fileKey) {
    return 0;
  }
  if (view === "list") {
    const index = model.flatFileKeys.indexOf(fileKey);
    return index >= 0 ? index : 0;
  }
  const index = visibleFileRowIndexRevealed(model, fileKey);
  return index >= 0 ? index : 0;
}

/** Row index after expanding the target file's collapsed ancestors. */
export function visibleFileRowIndexRevealed(
  model: FileTreeModel,
  fileKey: string,
): number {
  let offset = 0;
  for (const section of model.sections) {
    const ancestors = folderTreeAncestors(section.nodes, fileKey);
    const expanded = new Set(model.expanded);
    for (const key of ancestors) {
      expanded.add(key);
    }
    const rows = visibleFolderTreeRows(section.nodes, expanded);
    const index = rows.findIndex(
      (row) => row.kind === "file" && row.node.key === fileKey,
    );
    if (index >= 0) {
      return offset + index;
    }
    offset += rows.length;
  }
  return -1;
}

export function expandKeysForFile(
  model: FileTreeModel,
  fileKey: string,
): readonly string[] {
  for (const section of model.sections) {
    if (!folderTreeFileKeys(section.nodes).includes(fileKey)) {
      continue;
    }
    return folderTreeAncestors(section.nodes, fileKey);
  }
  return [];
}

export function parentFolderRowIndex(
  model: FileTreeModel,
  row: FolderTreeRow<FileTreePayload>,
): number | null {
  if (!row.parentFolderKey) {
    return null;
  }
  const index = model.rows.findIndex(
    (candidate) =>
      candidate.kind === "folder" &&
      candidate.node.key === row.parentFolderKey,
  );
  return index >= 0 ? index : null;
}

export function treeNavigationFiles(
  model: FileTreeModel,
): readonly { readonly key: string; readonly path: string }[] {
  return model.rows.flatMap((row) =>
    row.kind === "file"
      ? [{ key: row.node.key, path: row.node.payload.file.path }]
      : [],
  );
}

export function activeFileForAction(
  panel: PanelId,
  files: readonly ChangeFile[],
  filesView: FilesView,
  fileCursor: number,
  selectedPath: string | null,
  model: FileTreeModel,
): ChangeFile | null {
  if (panel === "diff") {
    return files.find((file) => file.path === selectedPath) ?? null;
  }
  if (filesView === "tree") {
    return activeTreeFileRow(model, fileCursor)?.node.payload.file ?? null;
  }
  return (
    files[fileCursor] ??
    files.find((file) => file.path === selectedPath) ??
    null
  );
}

export function treeSelectAction(
  filesView: FilesView,
  fileCursor: number,
  model: FileTreeModel,
): AppAction | null {
  if (filesView !== "tree") {
    return null;
  }
  const row = activeTreeRow(model, fileCursor);
  if (row?.kind === "folder") {
    return { type: "toggle-folder", key: row.node.key };
  }
  if (row?.kind === "file") {
    return {
      type: "select-file",
      index: fileCursor,
      path: row.node.payload.file.path,
    };
  }
  return null;
}

export function treeExpandAction(
  filesView: FilesView,
  fileCursor: number,
  model: FileTreeModel,
): AppAction | null {
  if (filesView !== "tree") {
    return null;
  }
  const row = activeTreeRow(model, fileCursor);
  return row?.kind === "folder" && !model.expanded.has(row.node.key)
    ? { type: "expand-folder", key: row.node.key }
    : null;
}

export function treeCollapseAction(
  filesView: FilesView,
  fileCursor: number,
  model: FileTreeModel,
): AppAction | null {
  if (filesView !== "tree") {
    return null;
  }
  const row = activeTreeRow(model, fileCursor);
  if (!row) {
    return null;
  }
  if (row.kind === "folder" && model.expanded.has(row.node.key)) {
    return { type: "collapse-folder", key: row.node.key };
  }
  const parentIndex = parentFolderRowIndex(model, row);
  return parentIndex === null
    ? null
    : { type: "set-cursor", panel: "files", index: parentIndex };
}

export function filesViewToggleActions(
  filesView: FilesView,
  fileCursor: number,
  selectedPath: string | null,
  model: FileTreeModel,
): readonly AppAction[] {
  const key = fileKeyAtCursor(model, filesView, fileCursor, selectedPath);
  const nextView: FilesView = filesView === "list" ? "tree" : "list";
  const actions: AppAction[] = [];
  if (nextView === "tree" && key) {
    const keys = expandKeysForFile(model, key);
    if (keys.length > 0) {
      actions.push({ type: "expand-folders", keys });
    }
  }
  actions.push({
    type: "toggle-files-view",
    fileCursor: cursorForView(model, nextView, key),
  });
  return actions;
}

export interface TreeJumpFilePlan {
  readonly actions: readonly AppAction[];
  readonly target: FileTarget;
  readonly fileCursor: number;
}

export function treeJumpFilePlan(
  model: FileTreeModel,
  searchFiles: readonly SearchFile[],
  currentFileKey: string | null,
  direction: 1 | -1,
): TreeJumpFilePlan | null {
  const targets = treeNavigationFiles(model).map((target) => ({
    key: target.key,
    path: target.path,
    hunks: [],
  }));
  const target =
    targets.length === 0
      ? nextFileTarget(searchFiles, currentFileKey, direction)
      : nextFileTarget(targets, currentFileKey, direction);
  if (!target) {
    return null;
  }

  const keys = expandKeysForFile(model, target.fileKey);
  return {
    actions: keys.length > 0 ? [{ type: "expand-folders", keys }] : [],
    target,
    fileCursor: visibleFileRowIndexRevealed(model, target.fileKey),
  };
}
