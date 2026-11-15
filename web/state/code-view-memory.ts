import type { Selection, SnapshotSide } from "../../shared/types";

export interface CodeViewMemory {
  readonly expanded: readonly string[];
  readonly cursor: number;
  readonly openPath: string | null;
  readonly line: number;
  /**
   * The review layout's selected path when this state was saved. It lets a
   * new diff selection win over the remembered open file.
   */
  readonly reviewPath: string | null;
}

/** Stable identity for a Selection, without depending on JSON key order. */
function selectionIdentity(selection: Selection): string {
  switch (selection.kind) {
    case "pending":
      return "pending";
    case "commit":
      return `commit:${selection.commit.hash}`;
    case "commits":
      return `commits:${selection.mode}:${selection.contiguous}:${selection.commits
        .map((commit) => commit.hash)
        .join(",")}`;
    case "time-window":
      return `window:${selection.window.preset}:${selection.window.start}:${selection.window.end}:${selection.mode}:${selection.contiguous}:${selection.commits
        .map((commit) => commit.hash)
        .join(",")}`;
    case "branch":
      return `branch:${selection.branch.name}:${selection.baseBranch.name}`;
  }
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

/** One remembered state per Snapshot: Selection + worktree + side. */
export function codeViewMemoryKey(
  selection: Selection,
  worktreePath: string | null,
  side: SnapshotSide,
): string {
  return `diff4ac:code-view:${hash(
    `${selectionIdentity(selection)}\u0000${worktreePath ?? ""}`,
  )}:${side}`;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** Session storage is best effort: private modes and quotas must not break it. */
export function readCodeViewMemory(key: string): CodeViewMemory | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CodeViewMemory>;
    if (
      !isStringArray(parsed.expanded) ||
      typeof parsed.cursor !== "number" ||
      typeof parsed.line !== "number" ||
      (parsed.openPath !== null && typeof parsed.openPath !== "string") ||
      (parsed.reviewPath !== null && typeof parsed.reviewPath !== "string")
    ) {
      return null;
    }
    return {
      expanded: parsed.expanded,
      cursor: Math.max(0, parsed.cursor),
      openPath: parsed.openPath,
      line: Math.max(1, parsed.line),
      reviewPath: parsed.reviewPath,
    };
  } catch {
    return null;
  }
}

export function writeCodeViewMemory(
  key: string,
  memory: CodeViewMemory,
): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(memory));
  } catch {
    // Ignore quota, disabled storage and serialization failures.
  }
}
