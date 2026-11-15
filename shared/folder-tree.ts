export interface FolderTreeFileEntry<T> {
  readonly kind?: "file";
  readonly path: string;
  /** Stable identity for the row; defaults to the path (with any key prefix). */
  readonly key?: string;
  readonly payload: T;
  readonly additions?: number;
  readonly deletions?: number;
  readonly reviewed?: boolean;
}

/** A folder whose children have not been loaded yet (for lazy trees). */
export interface FolderTreeFolderStub {
  readonly kind: "folder";
  readonly path: string;
  readonly key?: string;
  readonly childrenLoaded?: boolean;
}

export type FolderTreeEntry<T> = FolderTreeFileEntry<T> | FolderTreeFolderStub;

export interface FolderTreeOptions {
  /** Namespaces folder keys, e.g. one tree per commit in a Commit Stack. */
  readonly keyPrefix?: string;
}

export interface FolderTreeFile<T> {
  readonly kind: "file";
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly payload: T;
}

export interface FolderTreeFolder<T> {
  readonly kind: "folder";
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly children: readonly FolderTreeNode<T>[];
  readonly childrenLoaded: boolean;
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly reviewedCount: number;
}

export type FolderTreeNode<T> = FolderTreeFolder<T> | FolderTreeFile<T>;

export interface FolderTreeFolderRow<T> {
  readonly kind: "folder";
  readonly node: FolderTreeFolder<T>;
  readonly depth: number;
  readonly parentFolderKey: string | null;
}

export interface FolderTreeFileRow<T> {
  readonly kind: "file";
  readonly node: FolderTreeFile<T>;
  readonly depth: number;
  readonly parentFolderKey: string | null;
}

export type FolderTreeRow<T> = FolderTreeFolderRow<T> | FolderTreeFileRow<T>;

interface MutableFile<T> {
  readonly kind: "file";
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly payload: T;
  readonly additions: number;
  readonly deletions: number;
  readonly reviewed: boolean;
}

interface MutableFolder<T> {
  readonly name: string;
  readonly path: string;
  keyOverride: string | null;
  childrenLoaded: boolean;
  readonly folders: Map<string, MutableFolder<T>>;
  readonly files: MutableFile<T>[];
}

function keyForFolder<T>(
  folder: MutableFolder<T>,
  keyPrefix: string,
): string {
  return folder.keyOverride ?? `${keyPrefix}${folder.path}`;
}

function normalizePath(path: string): string[] {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
}

function compareNames(left: string, right: string): number {
  const byName = left.toLowerCase().localeCompare(right.toLowerCase());
  return byName !== 0 ? byName : left.localeCompare(right);
}

function emptyFolder<T>(
  name: string,
  path: string,
  keyOverride: string | null = null,
): MutableFolder<T> {
  return {
    name,
    path,
    keyOverride,
    childrenLoaded: true,
    folders: new Map(),
    files: [],
  };
}

function addEntry<T>(root: MutableFolder<T>, entry: FolderTreeEntry<T>, keyPrefix: string): void {
  const segments = normalizePath(entry.path);
  if (segments.length === 0) {
    return;
  }

  if (entry.kind === "folder") {
    let folder = root;
    for (const segment of segments) {
      const path = folder.path ? `${folder.path}/${segment}` : segment;
      let child = folder.folders.get(segment);
      if (!child) {
        child = emptyFolder<T>(segment, path);
        folder.folders.set(segment, child);
      }
      folder = child;
    }
    folder.childrenLoaded = entry.childrenLoaded ?? false;
    if (entry.key !== undefined) {
      folder.keyOverride = entry.key;
    }
    return;
  }

  const name = segments[segments.length - 1] ?? entry.path;
  let folder = root;
  for (const segment of segments.slice(0, -1)) {
    const path = folder.path ? `${folder.path}/${segment}` : segment;
    let child = folder.folders.get(segment);
    if (!child) {
      child = emptyFolder<T>(segment, path);
      folder.folders.set(segment, child);
    }
    folder = child;
  }
  folder.files.push({
    kind: "file",
    key: entry.key ?? `${keyPrefix}${entry.path}`,
    name,
    path: entry.path,
    payload: entry.payload,
    additions: entry.additions ?? 0,
    deletions: entry.deletions ?? 0,
    reviewed: entry.reviewed === true,
  });
}

function finalizeFile<T>(file: MutableFile<T>): FolderTreeFile<T> {
  return {
    kind: "file",
    key: file.key,
    name: file.name,
    path: file.path,
    payload: file.payload,
  };
}

function compactFolder<T>(
  folder: FolderTreeFolder<T>,
): FolderTreeFolder<T> {
  if (
    folder.children.length === 1 &&
    folder.children[0]?.kind === "folder"
  ) {
    const child = folder.children[0];
    return {
      ...child,
      name: `${folder.name}/${child.name}`,
    };
  }
  return folder;
}

function finalizeFolder<T>(
  folder: MutableFolder<T>,
  keyPrefix: string,
): FolderTreeFolder<T> {
  const childFolders = [...folder.folders.values()]
    .sort((left, right) => compareNames(left.name, right.name))
    .map((child) => compactFolder(finalizeFolder(child, keyPrefix)));
  const sortedFiles = [...folder.files].sort((left, right) =>
    compareNames(left.name, right.name),
  );
  const files = sortedFiles.map(finalizeFile);

  const children: FolderTreeNode<T>[] = [...childFolders, ...files];
  let fileCount = sortedFiles.length;
  let additions = sortedFiles.reduce((sum, file) => sum + file.additions, 0);
  let deletions = sortedFiles.reduce((sum, file) => sum + file.deletions, 0);
  let reviewedCount = sortedFiles.filter((file) => file.reviewed).length;
  for (const child of childFolders) {
    fileCount += child.fileCount;
    additions += child.additions;
    deletions += child.deletions;
    reviewedCount += child.reviewedCount;
  }

  return {
    kind: "folder",
    key: keyForFolder(folder, keyPrefix),
    name: folder.name,
    path: folder.path,
    children,
    childrenLoaded: folder.childrenLoaded,
    fileCount,
    additions,
    deletions,
    reviewedCount,
  };
}

export function buildFolderTree<T>(
  entries: readonly FolderTreeEntry<T>[],
  options: FolderTreeOptions = {},
): readonly FolderTreeNode<T>[] {
  const keyPrefix = options.keyPrefix ?? "";
  const root = emptyFolder<T>("", "");

  for (const entry of entries) {
    addEntry(root, entry, keyPrefix);
  }

  const folders = [...root.folders.values()]
    .sort((left, right) => compareNames(left.name, right.name))
    .map((child) => compactFolder(finalizeFolder(child, keyPrefix)));
  const files = [...root.files]
    .sort((left, right) => compareNames(left.name, right.name))
    .map(finalizeFile);

  return [...folders, ...files];
}

export function visibleFolderTreeRows<T>(
  nodes: readonly FolderTreeNode<T>[],
  expandedFolderKeys: ReadonlySet<string>,
): readonly FolderTreeRow<T>[] {
  const rows: FolderTreeRow<T>[] = [];

  const visit = (
    current: readonly FolderTreeNode<T>[],
    depth: number,
    parentFolderKey: string | null,
  ): void => {
    for (const node of current) {
      if (node.kind === "folder") {
        rows.push({
          kind: "folder",
          node,
          depth,
          parentFolderKey,
        });
        if (expandedFolderKeys.has(node.key)) {
          visit(node.children, depth + 1, node.key);
        }
      } else {
        rows.push({
          kind: "file",
          node,
          depth,
          parentFolderKey,
        });
      }
    }
  };

  visit(nodes, 0, null);
  return rows;
}

export function folderTreeFolderKeys<T>(
  nodes: readonly FolderTreeNode<T>[],
): readonly string[] {
  const keys: string[] = [];
  const visit = (current: readonly FolderTreeNode<T>[]): void => {
    for (const node of current) {
      if (node.kind !== "folder") {
        continue;
      }
      keys.push(node.key);
      visit(node.children);
    }
  };
  visit(nodes);
  return keys;
}

export function folderTreeFileKeys<T>(
  nodes: readonly FolderTreeNode<T>[],
): readonly string[] {
  const keys: string[] = [];
  const visit = (current: readonly FolderTreeNode<T>[]): void => {
    for (const node of current) {
      if (node.kind === "file") {
        keys.push(node.key);
      } else {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return keys;
}

export function folderTreeAncestors<T>(
  nodes: readonly FolderTreeNode<T>[],
  fileKey: string,
): readonly string[] {
  const visit = (
    current: readonly FolderTreeNode<T>[],
    ancestors: readonly string[],
  ): readonly string[] | null => {
    for (const node of current) {
      if (node.kind === "file") {
        if (node.key === fileKey) {
          return ancestors;
        }
        continue;
      }
      const found = visit(node.children, [...ancestors, node.key]);
      if (found) {
        return found;
      }
    }
    return null;
  };

  return visit(nodes, []) ?? [];
}

export function findFolderTreeFileRow<T>(
  rows: readonly FolderTreeRow<T>[],
  fileKey: string,
): { readonly row: FolderTreeFileRow<T>; readonly index: number } | null {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row?.kind === "file" && row.node.key === fileKey) {
      return { row, index };
    }
  }
  return null;
}

export function visibleFolderTreeFileKeys<T>(
  rows: readonly FolderTreeRow<T>[],
): readonly string[] {
  return rows.flatMap((row) => (row.kind === "file" ? [row.node.key] : []));
}
