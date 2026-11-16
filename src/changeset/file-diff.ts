import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { GitGateway } from "../git/gateway";
import { diffTempFiles } from "../git/temp-diff";
import { isSafeRelativePath } from "../paths";
import { isBinaryContent } from "./rename-pairing";
import type { FileStatusRecord } from "./parse";
import type { ChangeFileOptions, DiffRange } from "./types";
import {
  blobKey,
  gitBlobHash,
  honoursFileMode,
  indexEntryMode,
  readContentAtRev,
  worktreeEntryMode,
  worktreeFilePath,
  type BlobInfo,
  type ObjectFormat,
} from "./objects";

/** git has no "whole file" flag; a context this large covers any real file. */
const FULL_CONTEXT_LINES = 100_000_000;

export function contextArgs(options: ChangeFileOptions): string[] {
  return options.fullContext ? [`--unified=${FULL_CONTEXT_LINES}`] : [];
}

export function rangeArgs(range: DiffRange): string[] {
  return range.targetRef ? [range.baseRef, range.targetRef] : [range.baseRef];
}

export async function diffFor(
  git: GitGateway,
  range: DiffRange,
  record: FileStatusRecord,
  options: ChangeFileOptions,
): Promise<string> {
  if (record.status === "untracked") {
    const { stdout } = await git.diffUntracked(record.path);
    return stdout.toString("utf8");
  }

  const paths = record.oldPath ? [record.oldPath, record.path] : [record.path];
  return git.text([
    "diff",
    ...rangeArgs(range),
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    ...contextArgs(options),
    "--",
    ...paths,
  ]);
}

export interface PairedRenameDiff {
  readonly diff: string;
  readonly binary: boolean;
}

function bodyFromNoIndexDiff(output: string): string {
  const lines = output.split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  return hunkStart === -1 ? "" : lines.slice(hunkStart).join("\n");
}

/**
 * Mode change across a paired unstaged rename, worked out the way git would:
 * the old mode is the index entry's, the new one comes from the file on disk,
 * and the executable bit is ignored when core.fileMode is false.
 */
export async function pairedRenameModeChange(
  git: GitGateway,
  oldPath: string,
  newPath: string,
): Promise<{ oldMode: string; newMode: string } | null> {
  const oldMode = await indexEntryMode(git, oldPath);
  const diskMode = worktreeEntryMode(git, newPath);
  if (!oldMode || !diskMode || oldMode === diskMode) {
    return null;
  }

  const regular = (mode: string) => mode === "100644" || mode === "100755";
  if (regular(oldMode) && regular(diskMode) && !(await honoursFileMode(git))) {
    return null;
  }
  return { oldMode, newMode: diskMode };
}

export async function pairedRenameDiff(
  git: GitGateway,
  record: FileStatusRecord,
  options: ChangeFileOptions,
): Promise<PairedRenameDiff> {
  const oldPath = record.oldPath;
  if (
    !oldPath ||
    !isSafeRelativePath(oldPath) ||
    !isSafeRelativePath(record.path)
  ) {
    return { diff: "", binary: false };
  }

  const [oldContent, newContent] = await Promise.all([
    readContentAtRev(git, "index", oldPath),
    readContentAtRev(git, "worktree", record.path),
  ]);
  if (!oldContent || !newContent) {
    return { diff: "", binary: false };
  }

  const binary = isBinaryContent(oldContent) || isBinaryContent(newContent);
  const newPath = record.path;
  let body = "";

  if (binary && !oldContent.equals(newContent)) {
    body = `Binary files a/${oldPath} and b/${newPath} differ`;
  } else if (!binary && !oldContent.equals(newContent)) {
    const output = await diffTempFiles(
      git,
      oldPath,
      oldContent,
      record.path,
      newContent,
      contextArgs(options),
    );
    body = bodyFromNoIndexDiff(output);
  }

  const percentage = Math.min(
    100,
    Math.max(0, Math.round((record.similarity ?? 1) * 100)),
  );
  const modeChange = await pairedRenameModeChange(git, oldPath, newPath);
  const header = [
    `diff --git a/${oldPath} b/${newPath}`,
    ...(modeChange
      ? [`old mode ${modeChange.oldMode}`, `new mode ${modeChange.newMode}`]
      : []),
    `similarity index ${percentage}%`,
    `rename from ${oldPath}`,
    `rename to ${newPath}`,
  ];
  if (body) {
    header.push(`--- a/${oldPath}`, `+++ b/${newPath}`);
  }

  return {
    diff: `${header.join("\n")}\n${body}`,
    binary,
  };
}

function diffContentHash(diff: string): string {
  return `diff:${createHash("sha256").update(diff).digest("hex")}`;
}

export async function reviewContentHash(
  git: GitGateway,
  range: DiffRange,
  record: FileStatusRecord,
  diff: string,
  format: ObjectFormat,
  blobs: ReadonlyMap<string, BlobInfo | null>,
): Promise<string> {
  if (record.status === "deleted") {
    const oldHash = blobs.get(blobKey(range.baseRef, record.path))?.hash ?? null;
    return oldHash ? `deleted:${oldHash}` : `deleted:${diffContentHash(diff)}`;
  }

  if (range.targetRef) {
    const newHash = blobs.get(blobKey(range.targetRef, record.path))?.hash ?? null;
    return newHash ?? diffContentHash(diff);
  }

  const filePath = worktreeFilePath(git, record.path);
  if (filePath) {
    try {
      return gitBlobHash(readFileSync(filePath), format);
    } catch {
      return diffContentHash(diff);
    }
  }

  return diffContentHash(diff);
}

function hasOldSide(status: FileStatusRecord["status"]): boolean {
  return status !== "added" && status !== "untracked";
}

function hasNewSide(status: FileStatusRecord["status"]): boolean {
  return status !== "deleted";
}

export function oldRevision(
  range: DiffRange,
  record: FileStatusRecord,
): string | undefined {
  if (record.pairedRename) {
    return "index";
  }
  if (!hasOldSide(record.status)) {
    return undefined;
  }
  if (range.oldRev !== undefined) {
    return range.oldRev ?? undefined;
  }
  return range.baseRef;
}

export function newRevision(
  range: DiffRange,
  record: FileStatusRecord,
): string | undefined {
  if (record.pairedRename) {
    return "worktree";
  }
  if (!hasNewSide(record.status)) {
    return undefined;
  }
  if (range.newRev !== undefined) {
    return range.newRev ?? undefined;
  }
  return range.targetRef ?? "worktree";
}

/**
 * The record a `/api/file-*` request selects, mirroring `changeFileFor` in the
 * server: match by path, then by `rev` (index/worktree are only special for
 * Pending).
 */
export function selectChangeRecord(
  range: DiffRange,
  records: readonly FileStatusRecord[],
  path: string,
  rev: string | null,
  pendingScope: boolean,
): FileStatusRecord | undefined {
  const matches = records.filter((record) => record.path === path);
  if (matches.length === 0) {
    return undefined;
  }
  if (!rev) {
    return matches[0];
  }
  if ((rev === "index" || rev === "worktree") && pendingScope) {
    return matches[0];
  }
  return matches.find(
    (record) =>
      oldRevision(range, record) === rev || newRevision(range, record) === rev,
  );
}
