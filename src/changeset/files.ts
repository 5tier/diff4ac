import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { GitGateway } from "../git/gateway";
import { parseModeChange } from "../diff/mode";
import { extensionOf, isSafeRelativePath } from "../paths";
import type {
  ChangeFile,
  ChangeTotals,
  FileStatus,
  Hunk,
  HunkLine,
} from "../types";

const SHA1_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHA256_EMPTY_TREE =
  "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

export const LARGE_DIFF_LINE_LIMIT = 1500;

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
}

export interface FileStatusRecord {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: FileStatus;
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

function nulTokens(output: string): string[] {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") {
    tokens.pop();
  }
  return tokens;
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

interface StatusEntry {
  readonly code: string;
  readonly path: string;
}

function parseStatusEntries(statusOutput: string): StatusEntry[] {
  const tokens = nulTokens(statusOutput);
  const entries: StatusEntry[] = [];
  let index = 0;

  while (index < tokens.length) {
    const entry = tokens[index++] ?? "";
    if (entry.length < 4) {
      continue;
    }

    const code = entry.slice(0, 2);
    const path = entry.slice(3);

    if (code[0] === "R" || code[0] === "C") {
      index++;
    }

    entries.push({ code, path });
  }

  return entries;
}

export function parseUntracked(statusOutput: string): string[] {
  return parseStatusEntries(statusOutput)
    .filter((entry) => entry.code === "??")
    .map((entry) => entry.path);
}

export function countPendingFiles(statusOutput: string): number {
  return parseStatusEntries(statusOutput).length;
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

function gitBlobHash(content: Buffer, format: ObjectFormat): string {
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
    { allowExitCodes: [0, 1] },
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
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const size = Number.parseInt(result.stdout.toString("utf8").trim(), 10);
  return Number.isNaN(size) ? null : size;
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

function oldRevision(range: DiffRange, status: FileStatus): string | undefined {
  if (!hasOldSide(status)) {
    return undefined;
  }
  if (range.oldRev !== undefined) {
    return range.oldRev ?? undefined;
  }
  return range.baseRef;
}

function newRevision(range: DiffRange, status: FileStatus): string | undefined {
  if (!hasNewSide(status)) {
    return undefined;
  }
  if (range.newRev !== undefined) {
    return range.newRev ?? undefined;
  }
  return range.targetRef ?? "worktree";
}

async function reviewContentHash(
  git: GitGateway,
  range: DiffRange,
  record: FileStatusRecord,
  diff: string,
  format: ObjectFormat,
): Promise<string> {
  if (record.status === "deleted") {
    const oldHash = await blobHashAt(git, range.baseRef, record.path);
    return oldHash ? `deleted:${oldHash}` : `deleted:${diffContentHash(diff)}`;
  }

  if (range.targetRef) {
    const newHash = await blobHashAt(git, range.targetRef, record.path);
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
): Promise<string> {
  if (record.status === "untracked") {
    const { stdout } = await git.run(
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", "/dev/null", record.path],
      { allowExitCodes: [0, 1] },
    );
    return stdout.toString("utf8");
  }

  const paths = record.oldPath ? [record.oldPath, record.path] : [record.path];
  return git.text([
    "diff",
    ...rangeArgs(range),
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--",
    ...paths,
  ]);
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

  const files: ChangeFile[] = [];
  for (const record of records) {
    const diff = await diffFor(git, range, record);
    const stats = numstat.get(record.path);
    const fallback = countDiffLines(diff);
    const binary = stats?.binary ?? looksBinary(diff);
    const additions = binary ? 0 : (stats?.additions ?? fallback.additions);
    const deletions = binary ? 0 : (stats?.deletions ?? fallback.deletions);
    const modeChange = parseModeChange(diff);
    const oldRev = oldRevision(range, record.status);
    const newRev = newRevision(range, record.status);
    const collapsed =
      !binary &&
      !options.includeLargeDiffs &&
      additions + deletions > threshold;

    let oldSize: number | undefined;
    let newSize: number | undefined;
    if (binary) {
      if (oldRev) {
        const size = await contentSizeAtRev(
          git,
          oldRev,
          record.oldPath ?? record.path,
        );
        if (size !== null) {
          oldSize = size;
        }
      }
      if (newRev) {
        const size = await contentSizeAtRev(git, newRev, record.path);
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
      contentHash: await reviewContentHash(git, range, record, diff, format),
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

export async function buildChangeFilesForRange(
  git: GitGateway,
  range: DiffRange,
  options: ChangeFileOptions = {},
): Promise<ChangeFile[]> {
  const nameStatusOutput = await git.text([
    "diff",
    ...rangeArgs(range),
    "--name-status",
    "-z",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  return buildChangeFiles(
    git,
    range,
    parseNameStatus(nameStatusOutput),
    options,
  );
}

export function changeSetTotals(files: readonly ChangeFile[]): ChangeTotals {
  return files.reduce(
    (sum, file) => ({
      files: sum.files + 1,
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
