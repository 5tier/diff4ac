import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewMarkStore } from "../src/review/marks";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "diff4ac-marks-"));
  directories.push(directory);
  return directory;
}

function key(repositoryId: string, path: string, hash: string): string {
  return JSON.stringify([repositoryId, path, hash]);
}

function readMarks(directory: string): Record<string, number> {
  const parsed = JSON.parse(
    readFileSync(join(directory, "review-marks.json"), "utf8"),
  ) as { marks: Record<string, number> };
  return parsed.marks;
}

const DAY = 24 * 60 * 60 * 1000;

describe("Review Mark pruning", () => {
  test("drops old marks that are not for a current Pending file", () => {
    const directory = tempDirectory();
    const now = Date.UTC(2026, 0, 1);
    const repository = "repo";
    const other = "other-repo";
    const old = key(repository, "old.ts", "a".repeat(40));
    const active = key(repository, "active.ts", "b".repeat(40));
    const recent = key(repository, "recent.ts", "c".repeat(40));
    const otherRepo = key(other, "old.ts", "d".repeat(40));

    writeFileSync(
      join(directory, "review-marks.json"),
      JSON.stringify({
        version: 2,
        marks: {
          [old]: now - 91 * DAY,
          [active]: now - 91 * DAY,
          [recent]: now - 10 * DAY,
          [otherRepo]: now - 91 * DAY,
        },
      }),
    );

    const store = new ReviewMarkStore(directory);
    expect(store.hasMarksFor(repository)).toBe(true);
    store.prune(
      repository,
      [{ path: "active.ts", contentHash: "b".repeat(40) }],
      now,
    );

    const marks = readMarks(directory);
    expect(marks[old]).toBeUndefined();
    expect(marks[active]).toBe(now - 91 * DAY);
    expect(marks[recent]).toBe(now - 10 * DAY);
    expect(marks[otherRepo]).toBe(now - 91 * DAY);
  });

  test("caps a Repository at 5000 marks, dropping the oldest first", () => {
    const directory = tempDirectory();
    const now = Date.UTC(2026, 0, 1);
    const repository = "repo";
    const marks: Record<string, number> = {};
    for (let index = 0; index < 5_005; index++) {
      marks[key(repository, `file-${index}.ts`, index.toString(16).padStart(40, "0"))] =
        now - index * 1_000;
    }
    writeFileSync(
      join(directory, "review-marks.json"),
      JSON.stringify({ version: 2, marks }),
    );

    const store = new ReviewMarkStore(directory);
    store.prune(repository, [], now);

    const remaining = readMarks(directory);
    expect(Object.keys(remaining)).toHaveLength(5_000);
    expect(remaining[key(repository, "file-0.ts", "0".padStart(40, "0"))]).toBe(
      now,
    );
    expect(remaining[key(repository, "file-5004.ts", (5004).toString(16).padStart(40, "0"))]).toBeUndefined();
  });

  test("upgrades missing timestamps and writes atomically", () => {
    const directory = tempDirectory();
    const repository = "repo";
    const oldKey = key(repository, "old.ts", "a".repeat(40));
    writeFileSync(
      join(directory, "review-marks.json"),
      JSON.stringify({ version: 1, marks: { [oldKey]: true } }),
    );

    const store = new ReviewMarkStore(directory);
    expect(
      store.isMarked(repository, "old.ts", "a".repeat(40)),
    ).toBe(true);

    const upgraded = readMarks(directory);
    expect(typeof upgraded[oldKey]).toBe("number");
    expect(readdirSync(directory)).toEqual(["review-marks.json"]);

    store.setMarked(repository, "new.ts", "e".repeat(40), true);
    expect(readdirSync(directory)).toEqual(["review-marks.json"]);
    expect(() => readMarks(directory)).not.toThrow();
  });
});
