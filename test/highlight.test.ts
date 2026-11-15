import { expect, test } from "bun:test";
import type { Hunk } from "../shared/types";
import { highlightHunks, languageForPath, supportsLanguage } from "../web/highlight";

const hunk: Hunk = {
  header: "@@ -1,1 +1,1 @@",
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { type: "delete", content: "const answer = 41;", oldLine: 1, newLine: null },
    { type: "add", content: "const answer = 42;", oldLine: null, newLine: 1 },
  ],
};

test("loads a grammar lazily and highlights both diff sides", async () => {
  expect(supportsLanguage("typescript")).toBe(true);

  const [highlight] = await highlightHunks([hunk], "typescript");
  expect(highlight).toBeDefined();
  expect(highlight?.old).toHaveLength(1);
  expect(highlight?.new).toHaveLength(1);

  const oldLine = highlight?.old[0];
  const newLine = highlight?.new[0];
  expect(oldLine?.map((token) => token.content).join("")).toBe(
    "const answer = 41;",
  );
  expect(newLine?.map((token) => token.content).join("")).toBe(
    "const answer = 42;",
  );
  expect(
    [...(oldLine ?? []), ...(newLine ?? [])].some(
      (token) => token.style?.["--shiki-light"] !== undefined,
    ),
  ).toBe(true);
});

test("unknown languages report no support", () => {
  expect(languageForPath("data.unknownextension")).toBeNull();
  expect(supportsLanguage("unknownextension")).toBe(false);
});
