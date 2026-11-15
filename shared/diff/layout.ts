export type LayoutBlockKind =
  | "commit-heading"
  | "file-heading"
  | "file-mode"
  | "file-image"
  | "file-binary"
  | "file-collapsed";

export interface LayoutBlock {
  readonly kind: LayoutBlockKind;
  readonly fileKey: string | null;
  readonly commitHash: string | null;
  readonly offsetTop: number;
  readonly height: number;
}

export interface LayoutFile {
  readonly fileKey: string;
  /** The file's heading, the first thing rendered for the file. */
  readonly top: number;
  /** The rows container, when the file renders diff rows. */
  readonly rowsTop: number | null;
  readonly rowHeight: number;
  readonly rowCount: number;
  /** The next file's heading, or the bottom of the scroll content. */
  readonly bottom: number;
  /** Global row index where this file's rows begin in the change overview. */
  readonly rowStart: number;
}

export interface PaneLayout {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** Height of the tallest sticky heading at the top of the pane. */
  readonly stickyHeight: number;
  readonly blocks: readonly LayoutBlock[];
  readonly files: ReadonlyMap<string, LayoutFile>;
  readonly fileOrder: readonly string[];
}

export function layoutFile(
  layout: PaneLayout,
  fileKey: string,
): LayoutFile | null {
  return layout.files.get(fileKey) ?? null;
}

/** The file whose heading or rows sit at `offset`, using layout positions. */
export function fileKeyAtOffset(
  layout: PaneLayout,
  offset: number,
): string | null {
  let found: string | null = null;
  for (const key of layout.fileOrder) {
    const file = layout.files.get(key);
    if (!file) {
      continue;
    }
    if (file.top <= offset) {
      found = key;
    } else {
      break;
    }
  }
  return found ?? layout.fileOrder[0] ?? null;
}

/** The row inside `file` that covers `offset`, clamped to the file. */
export function rowAtOffset(file: LayoutFile, offset: number): number {
  if (file.rowsTop === null || file.rowCount === 0 || file.rowHeight <= 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(
      file.rowCount - 1,
      Math.floor((offset - file.rowsTop) / file.rowHeight),
    ),
  );
}

/** The top offset of a row, falling back to the file's heading. */
export function offsetForRow(file: LayoutFile, row: number): number {
  const base = file.rowsTop ?? file.top;
  if (file.rowsTop === null || file.rowCount === 0 || file.rowHeight <= 0) {
    return base;
  }
  return (
    base +
    Math.max(0, Math.min(file.rowCount - 1, row)) * file.rowHeight
  );
}
