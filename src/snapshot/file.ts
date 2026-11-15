import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { imageContentType, readContentAtRev } from "../changeset/files";
import { isBinaryContent } from "../changeset/rename-pairing";
import type { GitGateway } from "../git/gateway";
import type {
  SnapshotChangeMap,
  SnapshotRef,
} from "./scope";
import type {
  SnapshotEntryKind,
  SnapshotFile,
  SnapshotSide,
} from "../../shared/types";

const MAX_TEXT_BYTES = 1_000_000;
const MAX_TEXT_LINES = 20_000;
const MAX_FULL_BYTES = 20_000_000;

export class SnapshotTooLargeError extends Error {
  constructor() {
    super("Snapshot file is too large to return in full");
    this.name = "SnapshotTooLargeError";
  }
}

interface RawEntry {
  readonly kind: SnapshotEntryKind;
  readonly bytes?: Buffer;
  readonly submoduleOid?: string;
}

interface TreeRecord {
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
}

function parseLsTreeExact(output: string): TreeRecord | null {
  const token = output.split("\0")[0];
  if (!token) {
    return null;
  }
  const tab = token.indexOf("\t");
  if (tab === -1) {
    return null;
  }
  const [mode, type, oid] = token.slice(0, tab).split(" ");
  return mode && type && oid ? { mode, type, oid } : null;
}

async function commitEntry(
  git: GitGateway,
  rev: string,
  path: string,
): Promise<TreeRecord | null> {
  const { stdout } = await git.run(["ls-tree", "-z", rev, "--", path]);
  return parseLsTreeExact(stdout.toString("utf8"));
}

interface WorktreeStage {
  readonly mode: string;
  readonly oid: string;
}

async function worktreeStage(
  git: GitGateway,
  path: string,
): Promise<WorktreeStage | null> {
  const { stdout } = await git.run([
    "ls-files",
    "--stage",
    "-z",
    "--",
    path,
  ]);
  const token = stdout.toString("utf8").split("\0")[0];
  if (!token) {
    return null;
  }
  const tab = token.indexOf("\t");
  if (tab === -1) {
    return null;
  }
  const [mode, oid] = token.slice(0, tab).split(" ");
  return mode && oid ? { mode, oid } : null;
}

function worktreePath(root: string, path: string): string | null {
  const base = resolve(root);
  const full = resolve(base, path);
  if (full !== base && !full.startsWith(`${base}${sep}`)) {
    return null;
  }
  return full;
}

async function readCommitContent(
  git: GitGateway,
  rev: string,
  path: string,
): Promise<RawEntry | null> {
  const entry = await commitEntry(git, rev, path);
  if (!entry || entry.type === "tree") {
    return null;
  }
  if (entry.mode === "160000") {
    return { kind: "submodule", submoduleOid: entry.oid };
  }
  const bytes = await readContentAtRev(git, rev, path);
  if (!bytes) {
    return null;
  }
  return { kind: entry.mode === "120000" ? "symlink" : "file", bytes };
}

async function readWorktreeContent(
  git: GitGateway,
  root: string,
  path: string,
): Promise<RawEntry | null> {
  const stage = await worktreeStage(git, path);
  if (stage?.mode === "160000") {
    return { kind: "submodule", submoduleOid: stage.oid };
  }

  const full = worktreePath(root, path);
  if (!full) {
    return null;
  }

  let stats;
  try {
    stats = lstatSync(full);
  } catch {
    return null;
  }

  if (stats.isSymbolicLink()) {
    try {
      return {
        kind: "symlink",
        bytes: Buffer.from(readlinkSync(full), "utf8"),
      };
    } catch {
      return null;
    }
  }
  if (!stats.isFile()) {
    return null;
  }

  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(full);
    if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
      return null;
    }
    return { kind: "file", bytes: readFileSync(real) };
  } catch {
    return null;
  }
}

async function readContent(
  git: GitGateway,
  snapshot: SnapshotRef,
  path: string,
): Promise<RawEntry | null> {
  return snapshot.kind === "commit"
    ? readCommitContent(git, snapshot.rev, path)
    : readWorktreeContent(git, snapshot.root, path);
}

function countLines(text: string): number {
  if (text === "") {
    return 0;
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length;
}

function truncateText(text: string): { text: string; truncated: boolean } {
  let result = text;
  let truncated = false;

  const encoded = Buffer.from(result, "utf8");
  if (encoded.byteLength > MAX_TEXT_BYTES) {
    result = encoded.subarray(0, MAX_TEXT_BYTES).toString("utf8");
    truncated = true;
  }

  const lines = result.split("\n");
  if (lines.length > MAX_TEXT_LINES) {
    result = lines.slice(0, MAX_TEXT_LINES).join("\n");
    truncated = true;
  }

  return { text: result, truncated };
}

function fileFromContent(
  path: string,
  entry: RawEntry,
  status: SnapshotFile["status"],
  deleted: boolean,
  full: boolean,
): SnapshotFile {
  if (entry.kind === "submodule") {
    return {
      path,
      kind: "submodule",
      size: 0,
      binary: false,
      image: false,
      ...(entry.submoduleOid ? { submoduleOid: entry.submoduleOid } : {}),
      ...(status ? { status } : {}),
      ...(deleted ? { deleted: true } : {}),
    };
  }

  const bytes = entry.bytes ?? Buffer.alloc(0);
  if (full && bytes.byteLength > MAX_FULL_BYTES) {
    throw new SnapshotTooLargeError();
  }

  const binary = isBinaryContent(bytes);
  const image = entry.kind === "file" && imageContentType(path) !== null;
  if (binary) {
    return {
      path,
      kind: entry.kind,
      size: bytes.byteLength,
      binary: true,
      image,
      ...(status ? { status } : {}),
      ...(deleted ? { deleted: true } : {}),
    };
  }

  const text = bytes.toString("utf8");
  const totalLines = countLines(text);
  const truncated = full ? { text, truncated: false } : truncateText(text);

  return {
    path,
    kind: entry.kind,
    size: bytes.byteLength,
    binary: false,
    image,
    text: truncated.text,
    ...(truncated.truncated ? { truncated: true } : {}),
    totalLines,
    ...(status ? { status } : {}),
    ...(deleted ? { deleted: true } : {}),
  };
}

function hasGitSegment(path: string): boolean {
  return path.split("/").some((segment) => segment === ".git");
}

async function worktreeMember(
  git: GitGateway,
  path: string,
): Promise<boolean> {
  if (await worktreeStage(git, path)) {
    return true;
  }
  const { stdout } = await git.run([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    path,
  ]);
  return stdout
    .toString("utf8")
    .split("\0")
    .some((candidate) => candidate === path);
}

/**
 * A file endpoint may only read paths that belong to the Snapshot (or are
 * deleted/renamed ghosts served from the other side). Gitignored files and
 * `.git` internals are never part of a Snapshot.
 */
async function pathInSnapshot(
  git: GitGateway,
  snapshot: SnapshotRef,
  index: SnapshotChangeMap,
  path: string,
): Promise<boolean> {
  if (hasGitSegment(path)) {
    return false;
  }
  if (index.get(path)?.status === "deleted") {
    return true;
  }
  if (snapshot.kind === "worktree") {
    return worktreeMember(git, path);
  }
  const entry = await commitEntry(git, snapshot.rev, path);
  return Boolean(entry && entry.type !== "tree");
}

export async function readSnapshotFile(
  git: GitGateway,
  snapshot: SnapshotRef,
  fallback: SnapshotRef,
  index: SnapshotChangeMap,
  path: string,
  full: boolean,
  side: SnapshotSide,
): Promise<SnapshotFile | null> {
  if (!(await pathInSnapshot(git, snapshot, index, path))) {
    return null;
  }

  const change = index.get(path);
  // A deleted/renamed-away path on the after side is a ghost: serve the
  // before content, even if something ignored was recreated on disk.
  const direct =
    side === "after" && change?.status === "deleted"
      ? null
      : await readContent(git, snapshot, path);
  if (direct) {
    return fileFromContent(path, direct, change?.status, false, full);
  }

  if (change?.status !== "deleted") {
    return null;
  }

  const before = await readContent(git, fallback, path);
  return before
    ? fileFromContent(path, before, change.status, true, full)
    : null;
}

/** Raw bytes for an image request; null when the path is not a file. */
export async function readSnapshotBytes(
  git: GitGateway,
  snapshot: SnapshotRef,
  fallback: SnapshotRef,
  index: SnapshotChangeMap,
  path: string,
  side: SnapshotSide,
): Promise<Buffer | null> {
  if (!(await pathInSnapshot(git, snapshot, index, path))) {
    return null;
  }

  const change = index.get(path);
  const direct =
    side === "after" && change?.status === "deleted"
      ? null
      : await readContent(git, snapshot, path);
  if (direct) {
    return direct.bytes ?? null;
  }
  if (index.get(path)?.status !== "deleted") {
    return null;
  }
  return (await readContent(git, fallback, path))?.bytes ?? null;
}
