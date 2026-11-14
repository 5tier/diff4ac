import { describe, expect, test } from "bun:test";
import {
  isBinaryContent,
  pairRenames,
  similarityRatio,
  type RenameCandidate,
} from "../src/changeset/rename-pairing";

const encoder = new TextEncoder();

function candidate(
  path: string,
  content: string | Uint8Array,
  hash = `hash:${path}`,
): RenameCandidate {
  const bytes =
    typeof content === "string" ? encoder.encode(content) : content;
  return { path, hash, size: bytes.byteLength, content: bytes };
}

describe("rename similarity", () => {
  test("is 1 for identical content and 0 when one side is empty", () => {
    expect(similarityRatio(encoder.encode("one\ntwo\n"), encoder.encode("one\ntwo\n"))).toBe(1);
    expect(similarityRatio(encoder.encode("one\n"), encoder.encode(""))).toBe(0);
  });

  test("keeps a small edit above git's default similarity threshold", () => {
    const before = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
    const after = "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\n";

    expect(
      similarityRatio(encoder.encode(before), encoder.encode(after)),
    ).toBeGreaterThanOrEqual(0.5);
  });

  test("reports unrelated content as dissimilar", () => {
    const before = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
    const after = "one\ntwo\nthree\nfour\nfive\n";

    expect(
      similarityRatio(encoder.encode(before), encoder.encode(after)),
    ).toBeLessThan(0.5);
  });

  test("detects binary content by its NUL byte", () => {
    expect(isBinaryContent(Uint8Array.from([1, 2, 0, 4]))).toBe(true);
    expect(isBinaryContent(encoder.encode("plain text"))).toBe(false);
  });

  test("does not treat unrelated binary files as similar", () => {
    const left = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const right = Uint8Array.from([0, 9, 8, 7, 6, 5, 4, 3]);

    expect(similarityRatio(left, right)).toBeLessThan(0.5);
  });
});

describe("rename pairing", () => {
  test("pairs identical blobs first", () => {
    const pairs = pairRenames(
      [candidate("src/old.ts", "one\ntwo\n", "blob:same")],
      [candidate("src/new.ts", "one\ntwo\n", "blob:same")],
    );

    expect(pairs).toEqual([
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        similarity: 1,
      },
    ]);
  });

  test("pairs a move with edits when the content is similar enough", () => {
    const pairs = pairRenames(
      [
        candidate(
          "src/old.ts",
          "alpha\nbeta\ngamma\ndelta\nepsilon\n",
        ),
      ],
      [
        candidate(
          "src/new.ts",
          "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\n",
        ),
      ],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.oldPath).toBe("src/old.ts");
    expect(pairs[0]?.newPath).toBe("src/new.ts");
    expect(pairs[0]?.similarity).toBeGreaterThanOrEqual(0.5);
  });

  test("leaves unrelated files as a deletion plus an addition", () => {
    const pairs = pairRenames(
      [candidate("src/old.ts", "alpha\nbeta\ngamma\n")],
      [candidate("src/new.ts", "one\ntwo\nthree\n")],
    );

    expect(pairs).toEqual([]);
  });

  test("uses each old and new path in at most one pair", () => {
    const content = "alpha\nbeta\ngamma\n";
    const pairs = pairRenames(
      [
        candidate("src/a.ts", content, "blob:a"),
        candidate("src/b.ts", content, "blob:b"),
      ],
      [candidate("src/x.ts", content, "blob:x")],
    );

    expect(pairs).toEqual([
      {
        oldPath: "src/a.ts",
        newPath: "src/x.ts",
        similarity: 1,
      },
    ]);
  });

  test("breaks ties by path order", () => {
    const before = "alpha\nbeta\ngamma\ndelta\n";
    const after = "alpha\nBETA\ngamma\ndelta\nextra\n";
    const pairs = pairRenames(
      [
        candidate("src/b.ts", before, "blob:b"),
        candidate("src/a.ts", before, "blob:a"),
      ],
      [candidate("src/x.ts", after, "blob:x")],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.oldPath).toBe("src/a.ts");
  });

  test("skips similarity for large files but still pairs identical blobs", () => {
    const large = `${"x".repeat(32)}\n`.repeat(40);
    const options = { maxSimilarityBytes: large.length };

    expect(
      pairRenames(
        [candidate("src/large-old.ts", large)],
        [candidate("src/large-new.ts", `${large}extra\n`)],
        options,
      ),
    ).toEqual([]);

    expect(
      pairRenames(
        [candidate("src/large-old.ts", large, "blob:same")],
        [candidate("src/large-new.ts", large, "blob:same")],
        options,
      ),
    ).toEqual([
      {
        oldPath: "src/large-old.ts",
        newPath: "src/large-new.ts",
        similarity: 1,
      },
    ]);
  });

  test("skips similarity when there are too many candidate pairs", () => {
    const pairs = pairRenames(
      [candidate("src/old.ts", "alpha\nbeta\ngamma\n")],
      [candidate("src/new.ts", "alpha\nBETA\ngamma\n")],
      { maxSimilarityComparisons: 0 },
    );

    expect(pairs).toEqual([]);
  });
});
