import { describe, expect, test } from "bun:test";
import {
  applyFilters,
  DEFAULT_NOISE_PATTERNS,
  extensionOf,
  type FilterSettings,
} from "../src/filters";
import type {
  ChangeFile,
  ChangeSet,
  CommitChangeGroup,
  CommitSummary,
  FilterRequest,
} from "../src/types";

function file(path: string, overrides: Partial<ChangeFile> = {}): ChangeFile {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    diff: "",
    hunks: [],
    contentHash: "a".repeat(40),
    ...overrides,
  };
}

function commit(hash: string): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message: hash,
    author: { name: "Fixture Author", email: "fixture@example.com" },
    committedAt: "2024-01-01T12:00:00Z",
    relativeDate: "2 years ago",
    firstParent: null,
    agent: null,
  };
}

function changeSet(files: readonly ChangeFile[]): ChangeSet {
  return {
    selection: { kind: "pending" },
    worktree: { path: "/repo", branch: "main" },
    files,
    totals: { files: files.length, additions: 0, deletions: 0 },
  };
}

function stackChangeSet(
  groups: readonly {
    readonly commit: CommitSummary;
    readonly files: readonly ChangeFile[];
  }[],
): ChangeSet {
  const commitGroups: CommitChangeGroup[] = groups.map((group) => ({
    ...group,
    totals: {
      files: group.files.length,
      additions: 0,
      deletions: 0,
    },
  }));
  const files = commitGroups.flatMap((group) => group.files);

  return {
    selection: {
      kind: "commits",
      commits: groups.map((group) => group.commit),
      mode: "stack",
      contiguous: true,
    },
    worktree: { path: "/repo", branch: "main" },
    files,
    totals: { files: files.length, additions: 0, deletions: 0 },
    commitGroups,
  };
}

function settings(overrides: Partial<FilterSettings> = {}): FilterSettings {
  return {
    disabledExtensions: [],
    includeGlobs: [],
    excludeGlobs: [],
    hideNoise: true,
    noisePatterns: DEFAULT_NOISE_PATTERNS,
    ...overrides,
  };
}

function onlyRequest(request: FilterRequest): FilterSettings {
  return { ...request, noisePatterns: [] };
}

describe("Filter module", () => {
  test("extracts lower-case extensions and treats dotfiles as extensionless", () => {
    expect(extensionOf("src/app.TS")).toBe(".ts");
    expect(extensionOf("src/archive.tar.gz")).toBe(".gz");
    expect(extensionOf("README")).toBe("");
    expect(extensionOf("src/.gitignore")).toBe("");
  });

  test("hides default Noise patterns but leaves source files visible", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("bun.lock"),
      file("src/__snapshots__/app.snap"),
      file("dist/app.js"),
      file("packages/web/dist/index.js"),
    ]);

    const filtered = applyFilters(changeSetValue, settings());

    expect(filtered.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
    ]);
    expect(filtered.filter?.hiddenFiles).toBe(4);
    expect(filtered.filter?.availableExtensions).toEqual([
      ".js",
      ".lock",
      ".snap",
      ".ts",
    ]);
  });

  test("can reveal Noise and use a config-provided Noise list", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("bun.lock"),
      file("docs/generated.html"),
    ]);

    const revealed = applyFilters(
      changeSetValue,
      settings({ hideNoise: false }),
    );
    expect(revealed.files).toHaveLength(3);
    expect(revealed.filter?.hiddenFiles).toBe(0);

    const customNoise = applyFilters(
      changeSetValue,
      settings({ noisePatterns: ["docs/**"] }),
    );
    expect(customNoise.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "bun.lock",
    ]);
    expect(customNoise.filter?.hiddenFiles).toBe(1);
  });

  test("combines extension, include and exclude Filters", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("src/app.test.ts"),
      file("src/readme.md"),
      file("other/app.ts"),
    ]);

    const extensionOnly = applyFilters(
      changeSetValue,
      settings({ disabledExtensions: [".md"] }),
    );
    expect(extensionOnly.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "src/app.test.ts",
      "other/app.ts",
    ]);

    const included = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["src/**"] }),
    );
    expect(included.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "src/app.test.ts",
      "src/readme.md",
    ]);

    const combined = applyFilters(
      changeSetValue,
      settings({
        includeGlobs: ["src/**"],
        excludeGlobs: ["**/*.test.ts"],
        disabledExtensions: [".md"],
      }),
    );
    expect(combined.files.map((entry) => entry.path)).toEqual(["src/app.ts"]);
    expect(combined.filter?.hiddenFiles).toBe(3);
    expect(combined.filter?.disabledExtensions).toEqual([".md"]);
    expect(combined.filter?.includeGlobs).toEqual(["src/**"]);
    expect(combined.filter?.excludeGlobs).toEqual(["**/*.test.ts"]);
  });

  test("matches globs without a slash against basenames at any depth", () => {
    const changeSetValue = changeSet([
      file("src/a.ts"),
      file("docs/x.md"),
      file("other/y.md"),
      file("src/a.tmp"),
    ]);

    const included = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["*.md"] }),
    );
    expect(included.files.map((entry) => entry.path)).toEqual([
      "docs/x.md",
      "other/y.md",
    ]);

    const excluded = applyFilters(
      changeSetValue,
      settings({ excludeGlobs: ["*.ts"] }),
    );
    expect(excluded.files.map((entry) => entry.path)).toEqual([
      "docs/x.md",
      "other/y.md",
      "src/a.tmp",
    ]);

    const noise = applyFilters(
      changeSetValue,
      settings({ noisePatterns: ["*.tmp"] }),
    );
    expect(noise.files.map((entry) => entry.path)).toEqual([
      "src/a.ts",
      "docs/x.md",
      "other/y.md",
    ]);
    expect(noise.filter?.hiddenFiles).toBe(1);
  });

  test("matches globs with a slash against full paths and strips a leading slash", () => {
    const changeSetValue = changeSet([
      file("src/a.ts"),
      file("packages/x/src/b.ts"),
      file("docs/x.md"),
      file("ignored/a.tmp"),
      file("src/ignored/b.tmp"),
    ]);

    const fullPathInclude = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["src/*.ts"] }),
    );
    expect(fullPathInclude.files.map((entry) => entry.path)).toEqual([
      "src/a.ts",
    ]);

    const anchoredInclude = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["/src/**"] }),
    );
    expect(anchoredInclude.files.map((entry) => entry.path)).toEqual([
      "src/a.ts",
      "src/ignored/b.tmp",
    ]);

    const anchoredExclude = applyFilters(
      changeSetValue,
      settings({ excludeGlobs: ["/src/**"] }),
    );
    expect(anchoredExclude.files.map((entry) => entry.path)).toEqual([
      "packages/x/src/b.ts",
      "docs/x.md",
      "ignored/a.tmp",
    ]);

    const nestedNoise = applyFilters(
      changeSetValue,
      settings({ noisePatterns: ["ignored/**"] }),
    );
    expect(nestedNoise.files.map((entry) => entry.path)).toEqual([
      "src/a.ts",
      "packages/x/src/b.ts",
      "docs/x.md",
      "src/ignored/b.tmp",
    ]);
    expect(nestedNoise.filter?.hiddenFiles).toBe(1);
  });

  test("can hide files with no extension", () => {
    const changeSetValue = changeSet([file("README"), file("src/app.ts")]);

    const filtered = applyFilters(
      changeSetValue,
      onlyRequest({
        disabledExtensions: [""],
        includeGlobs: [],
        excludeGlobs: [],
        hideNoise: false,
      }),
    );

    expect(filtered.files.map((entry) => entry.path)).toEqual(["src/app.ts"]);
    expect(filtered.filter?.hiddenFiles).toBe(1);
  });

  test("filters every Commit Stack group and counts hidden paths once", () => {
    const first = commit("a".repeat(40));
    const second = commit("b".repeat(40));
    const changeSetValue = stackChangeSet([
      { commit: first, files: [file("src/app.ts"), file("bun.lock")] },
      { commit: second, files: [file("src/app.ts"), file("bun.lock")] },
    ]);

    const noiseHidden = applyFilters(changeSetValue, settings());
    expect(noiseHidden.commitGroups).toHaveLength(2);
    expect(
      noiseHidden.commitGroups?.map((group) =>
        group.files.map((entry) => entry.path),
      ),
    ).toEqual([["src/app.ts"], ["src/app.ts"]]);
    expect(noiseHidden.filter?.hiddenFiles).toBe(1);

    const allHidden = applyFilters(
      changeSetValue,
      settings({ disabledExtensions: [".ts"] }),
    );
    expect(allHidden.commitGroups).toEqual([]);
    expect(allHidden.files).toEqual([]);
    expect(allHidden.filter?.hiddenFiles).toBe(2);
  });

  test("filters Time Window Change Sets through the same path", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("src/app.lock"),
    ]);
    const timeWindowChangeSet: ChangeSet = {
      ...changeSetValue,
      selection: {
        kind: "time-window",
        window: {
          preset: "custom",
          start: "2024-01-01T00:00:00.000Z",
          end: "2024-01-02T00:00:00.000Z",
          label: "2024-01-01",
        },
        commits: [],
        mode: "net",
        contiguous: true,
      },
    };

    const filtered = applyFilters(timeWindowChangeSet, settings());

    expect(filtered.selection.kind).toBe("time-window");
    expect(filtered.files.map((entry) => entry.path)).toEqual(["src/app.ts"]);
    expect(filtered.filter?.hiddenFiles).toBe(1);
  });

  test("applies negated include, exclude and Noise patterns in order", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("src/app.test.ts"),
      file("src/generated/types.ts"),
      file("docs/x.md"),
    ]);

    const included = applyFilters(
      changeSetValue,
      settings({
        includeGlobs: [
          "src/**",
          "!src/**/*.test.ts",
          "!src/generated/**",
        ],
      }),
    );
    expect(included.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
    ]);

    const excluded = applyFilters(
      changeSetValue,
      settings({ excludeGlobs: ["src/**", "!src/app.ts"] }),
    );
    expect(excluded.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "docs/x.md",
    ]);

    const noise = applyFilters(
      changeSetValue,
      settings({ noisePatterns: ["src/**", "!src/app.ts"] }),
    );
    expect(noise.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "docs/x.md",
    ]);
    expect(noise.filter?.hiddenFiles).toBe(2);
  });

  test("lets the last matching pattern win in either direction", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("docs/x.md"),
    ]);

    const reExcluded = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["src/**", "!src/**"] }),
    );
    expect(reExcluded.files).toEqual([]);

    const reIncluded = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["!src/**", "src/**"] }),
    );
    expect(reIncluded.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
    ]);
  });

  test("treats a list of only negations as matching nothing", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("docs/x.md"),
    ]);

    const included = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["!docs/**"] }),
    );
    expect(included.files).toEqual([]);

    const excluded = applyFilters(
      changeSetValue,
      settings({ excludeGlobs: ["!src/**"] }),
    );
    expect(excluded.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "docs/x.md",
    ]);

    const noise = applyFilters(
      changeSetValue,
      settings({ noisePatterns: ["!docs/**"] }),
    );
    expect(noise.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "docs/x.md",
    ]);
    expect(noise.filter?.hiddenFiles).toBe(0);
  });

  test("matches a literal leading ! with an escaped \\!", () => {
    const changeSetValue = changeSet([
      file("!important.txt"),
      file("important.txt"),
      file("src/!important.txt"),
    ]);

    const filtered = applyFilters(
      changeSetValue,
      settings({ noisePatterns: ["\\!important.txt"] }),
    );

    expect(filtered.files.map((entry) => entry.path)).toEqual([
      "important.txt",
    ]);
    expect(filtered.filter?.hiddenFiles).toBe(2);
  });

  test("applies basename and anchored path rules to negated patterns", () => {
    const changeSetValue = changeSet([
      file("src/app.ts"),
      file("src/app.test.ts"),
      file("packages/lib/app.ts"),
      file("packages/lib/app.test.ts"),
    ]);

    const basename = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["*.ts", "!*.test.ts"] }),
    );
    expect(basename.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
      "packages/lib/app.ts",
    ]);

    const anchored = applyFilters(
      changeSetValue,
      settings({ includeGlobs: ["/src/**", "!/src/app.test.ts"] }),
    );
    expect(anchored.files.map((entry) => entry.path)).toEqual([
      "src/app.ts",
    ]);
  });
});
