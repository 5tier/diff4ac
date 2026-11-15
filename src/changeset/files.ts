import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  GIT_HEAVY_TIMEOUT_MS,
  type GitGateway,
} from "../git/gateway";
import { diffTempFiles } from "../git/temp-diff";
import { parseModeChange } from "../../shared/diff/mode";
import { nulTokens } from "../repository/status";
import { extensionOf, isSafeRelativePath } from "../paths";
import { isBinaryContent } from "./rename-pairing";
import type {
  ChangeFile,
  FileStatus,
  Hunk,
  HunkLine,
} from "../../shared/types";

const SHA1_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHA256_EMPTY_TREE =
  "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

export const LARGE_DIFF_LINE_LIMIT = 1500;

/** How many per-file git diffs may run at once while building a Change Set. */
export const FILE_DIFF_CONCURRENCY = 8;

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function imageContentType(path: string): string | null {
  return IMAGE_CONTENT_TYPES[extensionOf(path)] ?? null;
}

export function isImagePath(path: string): boolean {
  return imageContentType(path) !== null;
}

export interface ChangeFileOptions {
  readonly largeDiffThreshold?: number;
  readonly includeLargeDiffs?: boolean;
  /** Show every unchanged line of each file around its changes. */
  readonly fullContext?: boolean;
}

/** git has no "whole file" flag; a context this large covers any real file. */
const FULL_CONTEXT_LINES = 100_000_000;

function contextArgs(options: ChangeFileOptions): string[] {
  return options.fullContext ? [`--unified=${FULL_CONTEXT_LINES}`] : [];
}

export interface FileStatusRecord {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: FileStatus;
  readonly pairedRename?: boolean;
  readonly similarity?: number;
}

export interface DiffRange {
  readonly baseRef: string;
  readonly targetRef?: string;
  readonly oldRev?: string | null;
  readonly newRev?: string | null;
}

interface NumstatRecord {
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

function statusFromCode(code: string): FileStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechanged";
    case "U":
      return "unmerged";
    default:
      return "modified";
  }
}

export function parseNameStatus(output: string): FileStatusRecord[] {
  const tokens = nulTokens(output);
  const records: FileStatusRecord[] = [];
  let index = 0;

  while (index < tokens.length) {
    const code = tokens[index++] ?? "";
    if (!code) {
      continue;
    }

    if (code[0] === "R" || code[0] === "C") {
      const oldPath = tokens[index++] ?? "";
      const path = tokens[index++] ?? oldPath;
      records.push({ path, oldPath, status: statusFromCode(code) });
    } else {
      const path = tokens[index++] ?? "";
      if (path) {
        records.push({ path, status: statusFromCode(code) });
      }
    }
  }

  return records;
}

function parseNumstat(output: string): Map<string, NumstatRecord> {
  const tokens = nulTokens(output);
  const records = new Map<string, NumstatRecord>();
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index++] ?? "";
    if (!token) {
      continue;
    }

    const fields = token.split("\t");
    const additionsRaw = fields[0] ?? "0";
    const deletionsRaw = fields[1] ?? "0";
    let path = fields.slice(2).join("\t");

    if (path === "") {
      const oldPath = tokens[index++] ?? "";
      path = tokens[index++] ?? oldPath;
    }

    if (!path) {
      continue;
    }

    const binary = additionsRaw === "-" || deletionsRaw === "-";
    records.set(path, {
      additions: binary ? 0 : Number.parseInt(additionsRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deletionsRaw, 10) || 0,
      binary,
    });
  }

  return records;
}

export function looksBinary(diff: string): boolean {
  const header: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      break;
    }
    header.push(line);
  }

  const headerText = header.join("\n");
  return (
    headerText.includes("GIT binary patch") ||
    /^Binary files .* differ$/m.test(headerText)
  );
}

function parseIntOrZero(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: HunkLine[];
  } | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) {
      current = {
        header: line,
        oldStart: parseIntOrZero(match[1], 0),
        oldLines: parseIntOrZero(match[2], 1),
        newStart: parseIntOrZero(match[3], 0),
        newLines: parseIntOrZero(match[4], 1),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+")) {
      current.lines.push({
        type: "add",
        content: line.slice(1),
        oldLine: null,
        newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      current.lines.push({
        type: "delete",
        content: line.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine++;
    } else if (line.startsWith(" ")) {
      current.lines.push({
        type: "context",
        content: line.slice(1),
        oldLine,
        newLine,
      });
      oldLine++;
      newLine++;
    } else if (line.startsWith("\\ No newline at end of file")) {
      continue;
    } else if (line === "") {
      current = null;
    }
  }

  return hunks;
}

export type ObjectFormat = "sha1" | "sha256";

export async function objectFormat(git: GitGateway): Promise<ObjectFormat> {
  const format = (await git.text(["rev-parse", "--show-object-format"])).trim();
  return format === "sha256" ? "sha256" : "sha1";
}

export async function emptyTreeRef(git: GitGateway): Promise<string> {
  return (await objectFormat(git)) === "sha256"
    ? SHA256_EMPTY_TREE
    : SHA1_EMPTY_TREE;
}

export function gitBlobHash(content: Buffer, format: ObjectFormat): string {
  return createHash(format)
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function diffContentHash(diff: string): string {
  return `diff:${createHash("sha256").update(diff).digest("hex")}`;
}

async function blobHashAt(
  git: GitGateway,
  rev: string,
  path: string,
): Promise<string | null> {
  const result = await git.run(
    ["rev-parse", "--verify", "--quiet", `${rev}:${path}`],
    { allowExitCodes: [0, 1], retryOnEmpty: true },
  );
  if (result.exitCode !== 0) {
    return null;
  }

  const hash = result.stdout.toString("utf8").trim();
  return hash || null;
}

function worktreeFilePath(git: GitGateway, path: string): string | null {
  if (!isSafeRelativePath(path)) {
    return null;
  }

  let root: string;
  try {
    root = realpathSync(git.worktreeRoot);
  } catch {
    root = resolve(git.worktreeRoot);
  }

  const full = resolve(root, path);
  if (full !== root && !full.startsWith(`${root}${sep}`)) {
    return null;
  }

  try {
    const real = realpathSync(full);
    if (real !== root && !real.startsWith(`${root}${sep}`)) {
      return null;
    }
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

async function indexBlobHash(
  git: GitGateway,
  path: string,
): Promise<string | null> {
  if (!isSafeRelativePath(path)) {
    return null;
  }

  const { stdout } = await git.run([
    "ls-files",
    "--stage",
    "-z",
    "--",
    path,
  ]);
  for (const token of nulTokens(stdout.toString("utf8"))) {
    const tab = token.indexOf("\t");
    if (tab === -1 || token.slice(tab + 1) !== path) {
      continue;
    }
    const [mode, hash, stage] = token.slice(0, tab).split(" ");
    if (mode && hash && stage === "0") {
      return hash;
    }
  }
  return null;
}

async function indexEntryMode(
  git: GitGateway,
  path: string,
): Promise<string | null> {
  if (!isSafeRelativePath(path)) {
    return null;
  }

  const { stdout } = await git.run(["ls-files", "--stage", "-z", "--", path]);
  for (const token of nulTokens(stdout.toString("utf8"))) {
    const tab = token.indexOf("\t");
    if (tab === -1 || token.slice(tab + 1) !== path) {
      continue;
    }
    const [mode, , stage] = token.slice(0, tab).split(" ");
    if (mode && stage === "0") {
      return mode;
    }
  }
  return null;
}

async function honoursFileMode(git: GitGateway): Promise<boolean> {
  const result = await git.run(["config", "--bool", "--get", "core.fileMode"], {
    allowExitCodes: [0, 1],
  });
  return result.stdout.toString("utf8").trim() !== "false";
}

function worktreeEntryMode(git: GitGateway, path: string): string | null {
  const filePath = worktreeFilePath(git, path);
  if (!filePath) {
    return null;
  }
  try {
    const stats = lstatSync(join(git.worktreeRoot, path));
    if (stats.isSymbolicLink()) {
      return "120000";
    }
    return (stats.mode & 0o111) !== 0 ? "100755" : "100644";
  } catch {
    return null;
  }
}

/**
 * Mode change across a paired unstaged rename, worked out the way git would:
 * the old mode is the index entry's, the new one comes from the file on disk,
 * and the executable bit is ignored when core.fileMode is false.
 */
async function pairedRenameModeChange(
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

async function gitBlobContent(
  git: GitGateway,
  hash: string,
): Promise<Buffer | null> {
  const result = await git.run(["cat-file", "-p", hash], {
    allowExitCodes: [0, 128],
  });
  return result.exitCode === 0 ? result.stdout : null;
}

async function gitBlobSize(
  git: GitGateway,
  hash: string,
): Promise<number | null> {
  const result = await git.run(["cat-file", "-s", hash], {
    allowExitCodes: [0, 128],
    retryOnEmpty: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const size = Number.parseInt(result.stdout.toString("utf8").trim(), 10);
  return Number.isNaN(size) ? null : size;
}

interface BlobRequest {
  readonly rev: string;
  readonly path: string;
}

interface BlobInfo {
  readonly hash: string;
  readonly size: number | null;
}

const BLOB_KEY_SEPARATOR = "\0";

function blobKey(rev: string, path: string): string {
  return `${rev}${BLOB_KEY_SEPARATOR}${path}`;
}

/**
 * `cat-file --batch-check` reads one object per line, so a path containing a
 * newline (or an ambiguous `:`) has to stay on the per-file path.
 */
function isBatchableBlobRequest(request: BlobRequest): boolean {
  return !request.path.includes(":") && !request.path.includes("\n");
}

/**
 * Resolve blob hashes (and sizes) for many `<rev>:<path>` lookups with a single
 * `git cat-file --batch-check`, falling back to `rev-parse`/`cat-file -s` for
 * paths that cannot be expressed safely as batch input. Missing objects map to
 * null, as `blobHashAt` does today.
 */
async function resolveBlobInfo(
  git: GitGateway,
  requests: readonly BlobRequest[],
): Promise<ReadonlyMap<string, BlobInfo | null>> {
  const result = new Map<string, BlobInfo | null>();
  const batched = new Map<string, BlobRequest>();
  const fallback = new Map<string, BlobRequest>();

  for (const request of requests) {
    const key = blobKey(request.rev, request.path);
    if (result.has(key) || batched.has(key) || fallback.has(key)) {
      continue;
    }
    const target = isBatchableBlobRequest(request) ? batched : fallback;
    target.set(key, request);
  }

  if (batched.size > 0) {
    const entries = [...batched.entries()];
    const input = entries
      .map(([, request]) => `${request.rev}:${request.path}\n`)
      .join("");
    const { stdout } = await git.run(["cat-file", "--batch-check"], {
      input,
      retryOnEmpty: true,
      timeoutMs: GIT_HEAVY_TIMEOUT_MS,
    });
    const lines = stdout.toString("utf8").split("\n");

    entries.forEach(([key], index) => {
      const line = lines[index] ?? "";
      if (!line || line.endsWith(" missing") || line.endsWith(" ambiguous")) {
        result.set(key, null);
        return;
      }

      const [hash = "", , sizeRaw = ""] = line.split(" ");
      const size = Number.parseInt(sizeRaw, 10);
      if (!hash || Number.isNaN(size)) {
        result.set(key, null);
        return;
      }
      result.set(key, { hash, size });
    });
  }

  await Promise.all(
    [...fallback.entries()].map(async ([key, request]) => {
      const hash = await blobHashAt(git, request.rev, request.path);
      if (!hash) {
        result.set(key, null);
        return;
      }
      result.set(key, { hash, size: await gitBlobSize(git, hash) });
    }),
  );

  return result;
}

function contentHashRevision(
  range: DiffRange,
  record: FileStatusRecord,
): string | null {
  if (record.status === "deleted") {
    return range.baseRef;
  }
  return range.targetRef ?? null;
}

async function contentSizeFor(
  git: GitGateway,
  rev: string,
  path: string,
  blobs: ReadonlyMap<string, BlobInfo | null>,
): Promise<number | null> {
  if (rev === "worktree" || rev === "index") {
    return contentSizeAtRev(git, rev, path);
  }
  return blobs.get(blobKey(rev, path))?.size ?? null;
}

/**
 * Resolve every changed file's per-file git work with at most
 * `FILE_DIFF_CONCURRENCY` diffs in flight.
 */
async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await run(items[index] as Item, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function readContentAtRev(
  git: GitGateway,
  rev: string,
  path: string,
): Promise<Buffer | null> {
  if (rev === "worktree") {
    const filePath = worktreeFilePath(git, path);
    if (!filePath) {
      return null;
    }
    try {
      return readFileSync(filePath);
    } catch {
      return null;
    }
  }

  if (rev === "index") {
    const hash = await indexBlobHash(git, path);
    return hash ? gitBlobContent(git, hash) : null;
  }

  if (!isSafeRelativePath(path)) {
    return null;
  }
  const hash = await blobHashAt(git, rev, path);
  return hash ? gitBlobContent(git, hash) : null;
}

export async function contentSizeAtRev(
  git: GitGateway,
  rev: string,
  path: string,
): Promise<number | null> {
  if (rev === "worktree") {
    const filePath = worktreeFilePath(git, path);
    if (!filePath) {
      return null;
    }
    try {
      return statSync(filePath).size;
    } catch {
      return null;
    }
  }

  if (rev === "index") {
    const hash = await indexBlobHash(git, path);
    return hash ? gitBlobSize(git, hash) : null;
  }

  if (!isSafeRelativePath(path)) {
    return null;
  }
  const hash = await blobHashAt(git, rev, path);
  return hash ? gitBlobSize(git, hash) : null;
}

function hasOldSide(status: FileStatus): boolean {
  return status !== "added" && status !== "untracked";
}

function hasNewSide(status: FileStatus): boolean {
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

async function reviewContentHash(
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

function rangeArgs(range: DiffRange): string[] {
  return range.targetRef ? [range.baseRef, range.targetRef] : [range.baseRef];
}

async function diffFor(
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

interface PairedRenameDiff {
  readonly diff: string;
  readonly binary: boolean;
}

function bodyFromNoIndexDiff(output: string): string {
  const lines = output.split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  return hunkStart === -1 ? "" : lines.slice(hunkStart).join("\n");
}

async function pairedRenameDiff(
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

export function countDiffLines(diff: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      additions++;
    } else if (line.startsWith("-")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

interface PreparedChangeFile {
  readonly record: FileStatusRecord;
  readonly diff: string;
  readonly binary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly modeChange: ReturnType<typeof parseModeChange>;
  readonly oldRev: string | undefined;
  readonly newRev: string | undefined;
  readonly collapsed: boolean;
}

export async function buildChangeFiles(
  git: GitGateway,
  range: DiffRange,
  records: readonly FileStatusRecord[],
  options: ChangeFileOptions = {},
): Promise<ChangeFile[]> {
  const { stdout } = await git.run([
    "diff",
    ...rangeArgs(range),
    "--numstat",
    "-z",
    "--find-renames",
  ]);
  const numstat = parseNumstat(stdout.toString("utf8"));
  const format = await objectFormat(git);
  const threshold = options.largeDiffThreshold ?? LARGE_DIFF_LINE_LIMIT;

  const prepared = await mapWithConcurrency(
    records,
    FILE_DIFF_CONCURRENCY,
    async (record): Promise<PreparedChangeFile> => {
      const paired = record.pairedRename
        ? await pairedRenameDiff(git, record, options)
        : null;
      const diff = paired
        ? paired.diff
        : await diffFor(git, range, record, options);
      const stats = numstat.get(record.path);
      const fallback = countDiffLines(diff);
      const binary = paired
        ? paired.binary
        : (stats?.binary ?? looksBinary(diff));
      const additions = binary ? 0 : (stats?.additions ?? fallback.additions);
      const deletions = binary ? 0 : (stats?.deletions ?? fallback.deletions);
      const oldRev = oldRevision(range, record);
      const newRev = newRevision(range, record);
      const collapsed =
        !binary &&
        !options.includeLargeDiffs &&
        additions + deletions > threshold;

      return {
        record,
        diff,
        binary,
        additions,
        deletions,
        modeChange: parseModeChange(diff),
        oldRev,
        newRev,
        collapsed,
      };
    },
  );

  const blobRequests: BlobRequest[] = [];
  for (const item of prepared) {
    const hashRev = contentHashRevision(range, item.record);
    if (hashRev) {
      blobRequests.push({ rev: hashRev, path: item.record.path });
    }
    if (!item.binary) {
      continue;
    }
    const oldPath = item.record.oldPath ?? item.record.path;
    if (
      item.oldRev &&
      item.oldRev !== "index" &&
      item.oldRev !== "worktree" &&
      isSafeRelativePath(oldPath)
    ) {
      blobRequests.push({ rev: item.oldRev, path: oldPath });
    }
    if (
      item.newRev &&
      item.newRev !== "index" &&
      item.newRev !== "worktree" &&
      isSafeRelativePath(item.record.path)
    ) {
      blobRequests.push({ rev: item.newRev, path: item.record.path });
    }
  }
  const blobs = await resolveBlobInfo(git, blobRequests);

  const files: ChangeFile[] = [];
  for (const item of prepared) {
    const {
      record,
      diff,
      binary,
      additions,
      deletions,
      modeChange,
      oldRev,
      newRev,
      collapsed,
    } = item;

    let oldSize: number | undefined;
    let newSize: number | undefined;
    if (binary) {
      if (oldRev) {
        const size = await contentSizeFor(
          git,
          oldRev,
          record.oldPath ?? record.path,
          blobs,
        );
        if (size !== null) {
          oldSize = size;
        }
      }
      if (newRev) {
        const size = await contentSizeFor(git, newRev, record.path, blobs);
        if (size !== null) {
          newSize = size;
        }
      }
    }

    files.push({
      path: record.path,
      ...(record.oldPath ? { oldPath: record.oldPath } : {}),
      status: record.status,
      additions,
      deletions,
      binary,
      image: isImagePath(record.path),
      diff: collapsed ? "" : diff,
      hunks: binary || collapsed ? [] : parseHunks(diff),
      contentHash: await reviewContentHash(
        git,
        range,
        record,
        diff,
        format,
        blobs,
      ),
      ...(oldSize !== undefined ? { oldSize } : {}),
      ...(newSize !== undefined ? { newSize } : {}),
      ...(modeChange
        ? { oldMode: modeChange.oldMode, newMode: modeChange.newMode }
        : {}),
      ...(oldRev ? { oldRev } : {}),
      ...(newRev ? { newRev } : {}),
      ...(collapsed ? { collapsed: true } : {}),
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function listChangeRecords(
  git: GitGateway,
  range: DiffRange,
): Promise<FileStatusRecord[]> {
  const nameStatusOutput = await git.text([
    "diff",
    ...rangeArgs(range),
    "--name-status",
    "-z",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  return parseNameStatus(nameStatusOutput);
}

export async function buildChangeFilesForRange(
  git: GitGateway,
  range: DiffRange,
  options: ChangeFileOptions = {},
): Promise<ChangeFile[]> {
  return buildChangeFiles(
    git,
    range,
    await listChangeRecords(git, range),
    options,
  );
}
