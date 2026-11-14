import { describe, expect, test } from "bun:test";
import type { Hunk, HunkLine } from "../src/types";
import { buildDiffRows, wordDiffSegments } from "../src/diff/rows";
import { languageForPath } from "../web/highlight";

function line(
  type: HunkLine["type"],
  content: string,
  oldLine: number | null,
  newLine: number | null,
): HunkLine {
  return { type, content, oldLine, newLine };
}

function hunk(lines: readonly HunkLine[]): Hunk {
  return {
    header: "@@ -1,4 +1,4 @@",
    oldStart: 1,
    oldLines: 4,
    newStart: 1,
    newLines: 4,
    lines,
  };
}

const sample = hunk([
  line("context", "const value = 0;", 1, 1),
  line("delete", "const value = 1;", 2, null),
  line("add", "const value = 2;", null, 2),
  line("context", "return value;", 3, 3),
]);

describe("diff rows", () => {
  test("builds unified rows with line numbers, signs and word ranges", () => {
    const rows = buildDiffRows([sample], "unified");
    expect(rows.map((row) => row.kind)).toEqual([
      "hunk",
      "line",
      "line",
      "line",
      "line",
    ]);

    const deleted = rows[2];
    const added = rows[3];
    if (deleted?.kind !== "line" || added?.kind !== "line") {
      throw new Error("expected line rows");
    }

    expect(deleted.type).toBe("delete");
    expect(deleted.oldLine).toBe(2);
    expect(deleted.newLine).toBeNull();
    expect(deleted.word?.map((range) => deleted.content.slice(range.start, range.end))).toEqual([
      "1",
    ]);

    expect(added.type).toBe("add");
    expect(added.newLine).toBe(2);
    expect(added.word?.map((range) => added.content.slice(range.start, range.end))).toEqual([
      "2",
    ]);
  });

  test("pairs deletions with additions side by side", () => {
    const rows = buildDiffRows([sample], "side-by-side");
    const pairs = rows.filter((row) => row.kind === "split");

    expect(pairs).toHaveLength(3);
    const changed = pairs.find(
      (row) => row.kind === "split" && row.left?.type === "delete",
    );
    if (changed?.kind !== "split") {
      throw new Error("expected split row");
    }

    expect(changed.left?.content).toBe("const value = 1;");
    expect(changed.right?.content).toBe("const value = 2;");
    expect(changed.left?.lineNumber).toBe(2);
    expect(changed.right?.lineNumber).toBe(2);
  });

  test("shows unmatched additions on the right only", () => {
    const addedOnly = hunk([
      line("context", "same", 1, 1),
      line("add", "brand new", null, 2),
      line("add", "another new", null, 3),
    ]);
    const rows = buildDiffRows([addedOnly], "side-by-side");
    const additions = rows.filter(
      (row) => row.kind === "split" && row.left === null && row.right?.type === "add",
    );
    expect(additions).toHaveLength(2);
  });

  test("splits syntax tokens around word-level highlights", () => {
    const tokens = [
      { content: "const ", style: { "--shiki-light": "#111" } },
      { content: "value", style: { "--shiki-light": "#222" } },
      { content: " = 2;", style: { "--shiki-light": "#333" } },
    ];
    const segments = wordDiffSegments("const value = 2;", tokens, [
      { start: 14, end: 15 },
    ]);

    expect(segments.map((segment) => segment.text).join("")).toBe(
      "const value = 2;",
    );
    expect(segments.filter((segment) => segment.highlighted).map((segment) => segment.text)).toEqual([
      "2",
    ]);
  });
});

describe("language detection", () => {
  test("maps common extensions to Shiki languages", () => {
    expect(languageForPath("src/server.ts")).toBe("typescript");
    expect(languageForPath("web/app.tsx")).toBe("tsx");
    expect(languageForPath("README.md")).toBe("markdown");
    expect(languageForPath("scripts/build-web.ts")).toBe("typescript");
    expect(languageForPath("Cargo.toml")).toBe("toml");
    expect(languageForPath("Dockerfile")).toBe("docker");
  });

  test("falls back to plain text for unknown files", () => {
    expect(languageForPath("fixtures/data.unknownextension")).toBeNull();
    expect(languageForPath("LICENSE")).toBeNull();
  });
});
