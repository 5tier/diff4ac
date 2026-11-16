import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { SnapshotChangeMap, SnapshotRef } from "./scope";
import { isNoiseDirectory, isNoisePath } from "../filters";
import type { GitGateway } from "../git/gateway";
import type {
  SnapshotEntryKind,
  SnapshotTreeEntry,
} from "../../shared/types";

function childOf(relative: string): { name: string; nested: boolean } {
  const slash = relative.indexOf("/");
  return slash === -1
    ? { name: relative, nested: false }
    : { name: relative.slice(0, slash), nested: true };
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function underDir(path: string, dir: string): boolean {
  return dir === "" || path.startsWith(`${dir}/`);
}

function hasChangesUnder(index: SnapshotChangeMap, dir: string): boolean {
  for (const path of index.keys()) {
    if (underDir(path, dir) && path !== dir) {
      return true;
    }
  }
  return false;
}

function modeKind(mode: string, type: string): SnapshotEntryKind {
  if (type === "tree") {
    return "dir";
  }
  if (mode === "120000") {
    return "symlink";
  }
  if (mode === "160000") {
    return "submodule";
  }
  return "file";
}

function makeEntry(
  dir: string,
  name: string,
  kind: SnapshotEntryKind,
  index: SnapshotChangeMap,
  noisePatterns: readonly string[],
): SnapshotTreeEntry {
  const path = joinPath(dir, name);
  const change = index.get(path);
  return {
    name,
    path,
    kind,
    ...(change?.status ? { status: change.status } : {}),
    ...(change?.oldPath ? { oldPath: change.oldPath } : {}),
    ...(change?.renamedTo ? { renamedTo: change.renamedTo } : {}),
    ...(kind === "dir" ? { containsChanges: hasChangesUnder(index, path) } : {}),
    noise:
      kind === "dir"
        ? isNoiseDirectory(path, noisePatterns)
        : isNoisePath(path, noisePatterns),
  };
}

/**
 * Add Selection changes that are not in the Snapshot itself: deleted files
 * (after side) and the old side of renamed files, plus any folders they imply.
 */
function mergeChanges(
  entries: Map<string, SnapshotTreeEntry>,
  dir: string,
  index: SnapshotChangeMap,
  noisePatterns: readonly string[],
): void {
  for (const path of index.keys()) {
    if (!underDir(path, dir) || path === dir) {
      continue;
    }

    const relative = dir ? path.slice(dir.length + 1) : path;
    const child = childOf(relative);
    if (entries.has(child.name)) {
      continue;
    }

    if (child.nested) {
      entries.set(
        child.name,
        makeEntry(dir, child.name, "dir", index, noisePatterns),
      );
      continue;
    }

    entries.set(
      child.name,
      makeEntry(dir, child.name, "file", index, noisePatterns),
    );
  }
}

function sortEntries(entries: Iterable<SnapshotTreeEntry>): SnapshotTreeEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind === "dir" && right.kind !== "dir") {
      return -1;
    }
    if (left.kind !== "dir" && right.kind === "dir") {
      return 1;
    }
    return left.name
      .toLowerCase()
      .localeCompare(right.name.toLowerCase());
  });
}

interface TreeRecord {
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
  readonly path: string;
}

function parseLsTree(output: string): TreeRecord[] {
  const records: TreeRecord[] = [];
  for (const token of output.split("\0")) {
    if (!token) {
      continue;
    }
    const tab = token.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const [mode, type, oid] = token.slice(0, tab).split(" ");
    const path = token.slice(tab + 1);
    if (!mode || !type || !oid || !path) {
      continue;
    }
    records.push({ mode, type, oid, path });
  }
  return records;
}

async function commitEntry(
  git: GitGateway,
  rev: string,
  path: string,
): Promise<TreeRecord | null> {
  const { stdout } = await git.run(
    [
      "ls-tree",
      "-z",
      rev,
      "--",
      path,
    ],
    { emptyOk: true },
  );
  return parseLsTree(stdout.toString("utf8"))[0] ?? null;
}

async function listCommitTree(
  git: GitGateway,
  rev: string,
  dir: string,
  index: SnapshotChangeMap,
  noisePatterns: readonly string[],
): Promise<SnapshotTreeEntry[] | null> {
  const args = dir
    ? ["ls-tree", "-z", rev, "--", `${dir}/`]
    : ["ls-tree", "-z", rev];
  const { stdout } = await git.run(args, { emptyOk: true });
  const entries = new Map<string, SnapshotTreeEntry>();

  for (const record of parseLsTree(stdout.toString("utf8"))) {
    const relative = dir ? record.path.slice(dir.length + 1) : record.path;
    if (!relative || relative.includes("/")) {
      continue;
    }
    entries.set(
      relative,
      makeEntry(
        dir,
        relative,
        modeKind(record.mode, record.type),
        index,
        noisePatterns,
      ),
    );
  }

  if (entries.size === 0 && !hasChangesUnder(index, dir) && dir !== "") {
    const entry = await commitEntry(git, rev, dir);
    if (!entry || modeKind(entry.mode, entry.type) !== "dir") {
      return null;
    }
  }

  mergeChanges(entries, dir, index, noisePatterns);
  return sortEntries(entries.values());
}

interface StagedPath {
  readonly mode: string;
  readonly path: string;
}

function parseLsFilesStage(output: string): StagedPath[] {
  const paths: StagedPath[] = [];
  for (const token of output.split("\0")) {
    if (!token) {
      continue;
    }
    const tab = token.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const [mode] = token.slice(0, tab).split(" ");
    const path = token.slice(tab + 1);
    if (mode && path) {
      paths.push({ mode, path });
    }
  }
  return paths;
}

async function listWorktreeTree(
  git: GitGateway,
  root: string,
  dir: string,
  index: SnapshotChangeMap,
  noisePatterns: readonly string[],
): Promise<SnapshotTreeEntry[] | null> {
  const pathArgs = dir ? ["--", `${dir}/`] : [];
  const [tracked, untracked] = await Promise.all([
    git.text(["ls-files", "--stage", "-z", ...pathArgs], {
      emptyOk: true,
    }),
    git.text(
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        ...pathArgs,
      ],
      { emptyOk: true },
    ),
  ]);

  const entries = new Map<string, SnapshotTreeEntry>();

  for (const record of parseLsFilesStage(tracked)) {
    const relative = dir ? record.path.slice(dir.length + 1) : record.path;
    if (!relative) {
      continue;
    }
    const child = childOf(relative);
    if (entries.has(child.name)) {
      continue;
    }
    const kind = child.nested
      ? "dir"
      : modeKind(record.mode, "blob");
    entries.set(
      child.name,
      makeEntry(dir, child.name, kind, index, noisePatterns),
    );
  }

  for (const path of untracked.split("\0")) {
    if (!path) {
      continue;
    }
    const relative = dir ? path.slice(dir.length + 1) : path;
    if (!relative) {
      continue;
    }
    const child = childOf(relative);
    if (entries.has(child.name)) {
      continue;
    }
    let kind: SnapshotEntryKind = child.nested ? "dir" : "file";
    if (!child.nested) {
      try {
        if (lstatSync(join(root, path)).isSymbolicLink()) {
          kind = "symlink";
        }
      } catch {
        kind = "file";
      }
    }
    entries.set(
      child.name,
      makeEntry(dir, child.name, kind, index, noisePatterns),
    );
  }

  if (entries.size === 0 && !hasChangesUnder(index, dir) && dir !== "") {
    try {
      if (!lstatSync(join(root, dir)).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
  }

  mergeChanges(entries, dir, index, noisePatterns);
  return sortEntries(entries.values());
}

/** Immediate children of one folder, or null when the folder is missing. */
export async function listSnapshotTree(
  git: GitGateway,
  snapshot: SnapshotRef,
  index: SnapshotChangeMap,
  dir: string,
  noisePatterns: readonly string[],
): Promise<SnapshotTreeEntry[] | null> {
  if (dir.split("/").some((segment) => segment === ".git")) {
    return null;
  }
  if (snapshot.kind === "commit") {
    return listCommitTree(
      git,
      snapshot.rev,
      dir,
      index,
      noisePatterns,
    );
  }
  return listWorktreeTree(
    git,
    snapshot.root,
    dir,
    index,
    noisePatterns,
  );
}
