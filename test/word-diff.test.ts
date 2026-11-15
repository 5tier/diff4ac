import { describe, expect, test } from "bun:test";
import {
  tokenSimilarity,
  tokenizeLine,
  wordDiff,
} from "../shared/diff/word-diff";
import { alignChangeLines } from "../shared/diff/pairing";

function changed(line: string, ranges: readonly { start: number; end: number }[]) {
  return ranges.map((range) => line.slice(range.start, range.end));
}

describe("word diff", () => {
  test("highlights only the changed token in a modified line", () => {
    const oldLine = "const value = 1;";
    const newLine = "const value = 2;";
    const diff = wordDiff(oldLine, newLine);

    expect(changed(oldLine, diff.removed)).toEqual(["1"]);
    expect(changed(newLine, diff.added)).toEqual(["2"]);
  });

  test("highlights a renamed word and inserted punctuation", () => {
    const oldLine = "return oldName;";
    const newLine = "return format(newName);";
    const diff = wordDiff(oldLine, newLine);

    expect(changed(oldLine, diff.removed)).toEqual(["oldName"]);
    expect(changed(newLine, diff.added).join("")).toContain("newName");
    expect(changed(newLine, diff.added).join("")).toContain("format");
  });

  test("returns no ranges for identical lines", () => {
    expect(wordDiff("unchanged", "unchanged")).toEqual({
      removed: [],
      added: [],
    });
  });

  test("treats a fully rewritten line as changed", () => {
    const oldLine = "old contents";
    const newLine = "brand new";
    const diff = wordDiff(oldLine, newLine);

    expect(changed(oldLine, diff.removed).join("").replace(/\s+/g, "")).toBe(
      "oldcontents",
    );
    expect(changed(newLine, diff.added).join("").replace(/\s+/g, "")).toBe(
      "brandnew",
    );
  });

  test("merges adjacent unmatched tokens into one range", () => {
    const diff = wordDiff("alpha beta", "alpha gamma");
    expect(diff.removed).toHaveLength(1);
    expect(diff.added).toHaveLength(1);
  });

  test("tokenizes unicode identifiers and punctuation", () => {
    const tokens = tokenizeLine("const café = { ok: true };");
    expect(tokens.map((token) => token.text)).toContain("café");
    expect(tokens.map((token) => token.text)).toContain("{");
  });

  test("similarity prefers lines with shared words", () => {
    expect(tokenSimilarity("const a = 1", "const a = 2")).toBeGreaterThan(
      tokenSimilarity("const a = 1", "unrelated"),
    );
  });
});

describe("change line alignment", () => {
  test("pairs equal-length replacements in order", () => {
    expect(alignChangeLines(["one", "two"], ["one changed", "two changed"])).toEqual([
      { deleted: 0, added: 0 },
      { deleted: 1, added: 1 },
    ]);
  });

  test("pairs the most similar line and leaves the extra addition unmatched", () => {
    const alignment = alignChangeLines(
      ["const answer = 41;"],
      ["console.log(answer);", "const answer = 42;"],
    );

    expect(alignment).toContainEqual({ deleted: 0, added: 1 });
    expect(
      alignment.filter(
        (pair) => pair.deleted !== undefined && pair.added !== undefined,
      ),
    ).toHaveLength(1);
  });

  test("reports unmatched deletions when additions run out", () => {
    const alignment = alignChangeLines(["alpha", "beta"], ["alpha changed"]);
    expect(alignment).toContainEqual({ deleted: 0, added: 0 });
    expect(alignment).toContainEqual({ deleted: 1 });
  });
});
