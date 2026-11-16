import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  GIT_HEAVY_TIMEOUT_MS,
  type GitGateway,
} from "../git/gateway";
import { nulTokens } from "../../shared/nul-tokens";
import { isSafeRelativePath } from "../paths";

const SHA1_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHA256_EMPTY_TREE =
  "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

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

export function worktreeFilePath(
  git: GitGateway,
  path: string,
): string | null {
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

  const { stdout } = await git.run(
    [
      "ls-files",
      "--stage",
      "-z",
      "--",
      path,
    ],
    { emptyOk: true },
  );
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

export async function indexEntryMode(
  git: GitGateway,
  path: string,
): Promise<string | null> {
  if (!isSafeRelativePath(path)) {
    return null;
  }

  const { stdout } = await git.run(
    ["ls-files", "--stage", "-z", "--", path],
    { emptyOk: true },
  );
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

export async function honoursFileMode(git: GitGateway): Promise<boolean> {
  const result = await git.run(["config", "--bool", "--get", "core.fileMode"], {
    allowExitCodes: [0, 1],
  });
  return result.stdout.toString("utf8").trim() !== "false";
}

export function worktreeEntryMode(
  git: GitGateway,
  path: string,
): string | null {
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

async function gitBlobContent(
  git: GitGateway,
  hash: string,
): Promise<Buffer | null> {
  const result = await git.run(["cat-file", "-p", hash], {
    allowExitCodes: [0, 128],
    emptyOk: true,
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

export interface BlobRequest {
  readonly rev: string;
  readonly path: string;
}

export interface BlobInfo {
  readonly hash: string;
  readonly size: number | null;
}

const BLOB_KEY_SEPARATOR = "\0";

export function blobKey(rev: string, path: string): string {
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
export async function resolveBlobInfo(
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

export async function contentSizeFor(
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
