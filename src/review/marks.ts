import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isSafeRelativePath } from "../paths";
import type { ChangeFile, ChangeSet } from "../types";

export { isSafeRelativePath as isValidReviewPath };

interface ReviewMarkFile {
  readonly version: 1;
  readonly marks: Record<string, true>;
}

const MARKS_FILE = "review-marks.json";
const BLOB_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function defaultReviewMarkDirectory(): string {
  return join(homedir(), ".diff4ac");
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
  private readonly marks = new Map<string, true>();
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

    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as ReviewMarkFile;
      for (const [key, value] of Object.entries(parsed.marks ?? {})) {
        if (value === true) {
          this.marks.set(key, true);
        }
      }
    } catch {
      // A corrupt marks file should never stop the Reviewer.
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
      this.marks.set(key, true);
    } else {
      this.marks.delete(key);
    }

    this.save();
  }

  private save(): void {
    mkdirSync(this.directory, { recursive: true });
    const data: ReviewMarkFile = {
      version: 1,
      marks: Object.fromEntries(this.marks),
    };
    const file = this.filePath();
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(temporary, file);
  }
}

function annotateFile(
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
