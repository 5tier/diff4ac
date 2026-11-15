import { describe, expect, test } from "bun:test";
import { fuzzyScore, rankPaths } from "../shared/fuzzy-paths";

describe("fuzzy path ranking", () => {
  test("matches subsequences case-insensitively", () => {
    expect(fuzzyScore("app", "src/App.tsx")).not.toBeNull();
    expect(fuzzyScore("APP", "src/App.tsx")).not.toBeNull();
    expect(fuzzyScore("xyz", "src/App.tsx")).toBeNull();
    expect(fuzzyScore("psx", "src/App.tsx")).not.toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  test("prefers basename, consecutive characters and segment starts", () => {
    const basename = fuzzyScore("app", "src/app.ts") ?? -1;
    const middle = fuzzyScore("app", "src/application/thing.ts") ?? -1;
    expect(basename).toBeGreaterThan(middle);

    const consecutive = fuzzyScore("app", "src/app.ts") ?? -1;
    const split = fuzzyScore("app", "src/a/p/p.ts") ?? -1;
    expect(consecutive).toBeGreaterThan(split);

    const segment = fuzzyScore("sr", "src/app.ts") ?? -1;
    const inside = fuzzyScore("sr", "src/app.ts") ?? -1;
    expect(segment).toBe(inside);
  });

  test("ranks best matches first and honours the limit", () => {
    const paths = [
      "src/application.ts",
      "src/app.ts",
      "app/main.ts",
      "docs/app-guide.md",
      "src/unrelated.ts",
    ];

    const ranked = rankPaths("app", paths, 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]).toBe("src/app.ts");
    expect(ranked).toContain("src/application.ts");

    expect(rankPaths("app", paths, 10)).toHaveLength(4);
    expect(rankPaths("nope", paths, 10)).toEqual([]);
  });
});
