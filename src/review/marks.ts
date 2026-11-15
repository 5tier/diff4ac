import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ChangeFile, ChangeSet } from "../../shared/types";

interface ReviewMarkFile {
  readonly version?: number;
  readonly marks?: Record<string, true | number>;
}

const MARKS_FILE = "review-marks.json";
const BLOB_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_MARKS_PER_REPOSITORY = 5_000;

interface ParsedMarkKey {
  readonly repositoryId: string;
  readonly path: string;
  readonly contentHash: string;
}

function parseMarkKey(key: string): ParsedMarkKey | null {
  try {
    const value = JSON.parse(key) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      typeof value[2] === "string"
    ) {
      return {
        repositoryId: value[0],
        path: value[1],
        contentHash: value[2],
      };
    }
  } catch {
    // Ignore malformed stored keys.
  }
  return null;
}

export function isValidContentHash(value: string): boolean {
  if (BLOB_HASH.test(value)) {
    return true;
  }

  if (value.startsWith("diff:")) {
    return BLOB_HASH.test(value.slice("diff:".length));
  }

  if (value.startsWith("deleted:")) {
    const rest = value.slice("deleted:".length);
    if (BLOB_HASH.test(rest)) {
      return true;
    }
    return (
      rest.startsWith("diff:") &&
      BLOB_HASH.test(rest.slice("diff:".length))
    );
  }

  return false;
}

function markKey(
  repositoryId: string,
  path: string,
  contentHash: string,
): string {
  return JSON.stringify([repositoryId, path, contentHash]);
}

export class ReviewMarkStore {
  private readonly marks = new Map<string, number>();
  private loaded = false;

  constructor(readonly directory: string) {}

  private filePath(): string {
    return join(this.directory, MARKS_FILE);
  }

  private load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    const file = this.filePath();
    if (!existsSync(file)) {
      return;
    }

    let upgraded = false;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as ReviewMarkFile;
      for (const [key, value] of Object.entries(parsed.marks ?? {})) {
        if (value === true) {
          this.marks.set(key, Date.now());
          upgraded = true;
        } else if (typeof value === "number" && Number.isFinite(value)) {
          this.marks.set(key, value);
        }
      }
    } catch {
      // A corrupt marks file should never stop the Reviewer.
    }

    if (upgraded) {
      this.save();
    }
  }

  hasMarksFor(repositoryId: string): boolean {
    this.load();
    for (const key of this.marks.keys()) {
      if (parseMarkKey(key)?.repositoryId === repositoryId) {
        return true;
      }
    }
    return false;
  }

  prune(
    repositoryId: string,
    active: readonly { readonly path: string; readonly contentHash: string }[],
    now = Date.now(),
  ): void {
    this.load();
    const activeKeys = new Set(
      active.map((file) =>
        markKey(repositoryId, file.path, file.contentHash),
      ),
    );
    const remaining: { key: string; markedAt: number }[] = [];
    let changed = false;

    for (const [key, markedAt] of this.marks) {
      const parsed = parseMarkKey(key);
      if (!parsed || parsed.repositoryId !== repositoryId) {
        continue;
      }
      if (now - markedAt > MAX_AGE_MS && !activeKeys.has(key)) {
        this.marks.delete(key);
        changed = true;
      } else {
        remaining.push({ key, markedAt });
      }
    }

    remaining.sort((left, right) => left.markedAt - right.markedAt);
    if (remaining.length > MAX_MARKS_PER_REPOSITORY) {
      for (const entry of remaining.slice(
        0,
        remaining.length - MAX_MARKS_PER_REPOSITORY,
      )) {
        this.marks.delete(entry.key);
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }
  }

  isMarked(
    repositoryId: string,
    path: string,
    contentHash: string,
  ): boolean {
    this.load();
    return this.marks.has(markKey(repositoryId, path, contentHash));
  }

  setMarked(
    repositoryId: string,
    path: string,
    contentHash: string,
    marked: boolean,
  ): void {
    this.load();
    const key = markKey(repositoryId, path, contentHash);

    if (marked) {
      this.marks.set(key, Date.now());
    } else {
      this.marks.delete(key);
    }

    this.save();
  }

  private save(): void {
    mkdirSync(this.directory, { recursive: true });
    const data: ReviewMarkFile = {
      version: 2,
      marks: Object.fromEntries(this.marks),
    };
    const file = this.filePath();
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(temporary, file);
  }
}

export function annotateFile(
  file: ChangeFile,
  store: ReviewMarkStore,
  repositoryId: string,
): ChangeFile {
  return {
    ...file,
    reviewed: store.isMarked(repositoryId, file.path, file.contentHash),
  };
}

export function annotateChangeSet(
  changeSet: ChangeSet,
  store: ReviewMarkStore,
  repositoryId: string,
): ChangeSet {
  if (changeSet.commitGroups) {
    const commitGroups = changeSet.commitGroups.map((group) => ({
      ...group,
      files: group.files.map((file) => annotateFile(file, store, repositoryId)),
    }));

    return {
      ...changeSet,
      files: commitGroups.flatMap((group) => group.files),
      commitGroups,
    };
  }

  return {
    ...changeSet,
    files: changeSet.files.map((file) =>
      annotateFile(file, store, repositoryId),
    ),
  };
}
