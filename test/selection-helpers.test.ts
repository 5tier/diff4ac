import { describe, expect, test } from "bun:test";
import { ApiError } from "../web/api-error";
import type {
  BranchSummary,
  ChangeFile,
  ChangeSet,
  CommitSummary,
  Selection,
  TimeWindow,
} from "../src/types";
import {
  activeFilterSummary,
  emptyFilesMessage,
  fullFileCacheKey,
  hiddenFilesLabel,
  isNotFoundError,
  missingSelectionLabel,
  modeLabel,
  modeStatusLabel,
  replaceChangeFile,
  sameTimeWindowSelection,
  selectionBadge,
  selectionCacheKey,
  selectionFromPicks,
  selectionFromTimeWindow,
  selectionIncludesCommit,
  selectionLabel,
  setChangeFileReviewState,
  splitGlobLines,
  stackFileId,
  stackFileIndices,
  stackFileKey,
} from "../web/state/selection";

function makeCommit(
  hash: string,
  firstParent: string | null = null,
): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message: `message ${hash}`,
    author: { name: "Ada", email: "ada@example.com" },
    committedAt: "2026-06-01T12:00:00Z",
    relativeDate: "now",
    firstParent,
    agent: null,
  };
}

function makeFile(path: string, overrides: Partial<ChangeFile> = {}): ChangeFile {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    diff: "",
    hunks: [],
    contentHash: `hash-${path}`,
    oldRev: "old",
    newRev: "new",
    ...overrides,
  };
}

const c1 = makeCommit("c1aaaaaa");
const c2 = makeCommit("c2bbbbbb", c1.hash);
const c3 = makeCommit("c3cccccc", c2.hash);
const commits = [c3, c2, c1];

const branch: BranchSummary = {
  name: "feature",
  hash: "abcdef",
  shortHash: "abcdef",
  current: false,
};

const windowA: TimeWindow = {
  preset: "custom",
  start: "2026-01-01T00:00:00Z",
  end: "2027-01-01T00:00:00Z",
  label: "2026",
};

const windowB: TimeWindow = {
  ...windowA,
  label: "2026 again",
};

describe("selection labels", () => {
  test("labels and badges each Selection kind", () => {
    expect(selectionLabel({ kind: "pending" })).toBe("Pending");
    expect(selectionBadge({ kind: "pending" })).toBe("Pending");

    const commitSelection: Selection = { kind: "commit", commit: c1 };
    expect(selectionLabel(commitSelection)).toBe(
      `Commit ${c1.shortHash} · ${c1.message}`,
    );
    expect(selectionBadge(commitSelection)).toBe(`Commit ${c1.shortHash}`);

    const commitsSelection: Selection = {
      kind: "commits",
      commits: [c3, c2],
      mode: "net",
      contiguous: true,
    };
    expect(selectionLabel(commitsSelection)).toBe("2 commits · Net Diff");
    expect(selectionBadge(commitsSelection)).toBe("Commits 2");

    const windowSelection: Selection = {
      kind: "time-window",
      window: windowA,
      commits,
      mode: "stack",
      contiguous: true,
    };
    expect(selectionLabel(windowSelection)).toBe(
      "Time Window · 2026",
    );
    expect(selectionBadge(windowSelection)).toBe("Time Window");

    const branchSelection: Selection = {
      kind: "branch",
      branch,
      baseBranch: { name: "main", ref: "refs/heads/main" },
    };
    expect(selectionLabel(branchSelection)).toBe(
      "Branch feature since main",
    );
    expect(selectionBadge(branchSelection)).toBe("Branch feature");
  });

  test("mode labels and status labels", () => {
    expect(modeLabel("net")).toBe("Net Diff");
    expect(modeLabel("stack")).toBe("Commit Stack");
    expect(modeStatusLabel({ kind: "pending" })).toBeNull();
    expect(
      modeStatusLabel({
        kind: "commits",
        commits: [c3, c2],
        mode: "net",
        contiguous: true,
      }),
    ).toBe("Net Diff");
    expect(
      modeStatusLabel({
        kind: "commits",
        commits: [c3, c1],
        mode: "stack",
        contiguous: false,
      }),
    ).toBe("Commit Stack (non-contiguous)");
  });

  test("empty file messages", () => {
    expect(emptyFilesMessage({ kind: "pending" })).toContain("No Pending");
    expect(emptyFilesMessage({ kind: "commit", commit: c1 })).toContain(
      "no file changes",
    );
    expect(
      emptyFilesMessage({
        kind: "time-window",
        window: windowA,
        commits: [],
        mode: "net",
        contiguous: true,
      }),
    ).toContain("No commits landed");
    expect(
      emptyFilesMessage({
        kind: "time-window",
        window: windowA,
        commits,
        mode: "net",
        contiguous: true,
      }),
    ).toContain("no file changes");
    expect(
      emptyFilesMessage({
        kind: "branch",
        branch,
        baseBranch: { name: "feature", ref: "refs/heads/feature" },
      }),
    ).toContain("Base Branch");
  });

  test("missing Selection labels", () => {
    expect(missingSelectionLabel({ kind: "pending" })).toBe("This Worktree");
    expect(missingSelectionLabel({ kind: "commit", commit: c1 })).toBe(
      `Commit ${c1.shortHash}`,
    );
    expect(
      missingSelectionLabel({
        kind: "commits",
        commits: [c1, c2],
        mode: "net",
        contiguous: true,
      }),
    ).toBe("2 commits");
    expect(
      missingSelectionLabel({
        kind: "time-window",
        window: windowA,
        commits,
        mode: "net",
        contiguous: true,
      }),
    ).toBe("Time Window 2026");
    expect(
      missingSelectionLabel({
        kind: "branch",
        branch,
        baseBranch: { name: "main", ref: "refs/heads/main" },
      }),
    ).toBe("Branch feature");
  });
});

describe("selection construction", () => {
  test("selectionIncludesCommit only matches commit-backed Selections", () => {
    expect(
      selectionIncludesCommit({ kind: "commit", commit: c1 }, c1.hash),
    ).toBe(true);
    expect(
      selectionIncludesCommit(
        {
          kind: "commits",
          commits: [c1, c2],
          mode: "net",
          contiguous: true,
        },
        c2.hash,
      ),
    ).toBe(true);
    expect(selectionIncludesCommit({ kind: "pending" }, c1.hash)).toBe(false);
  });

  test("selectionFromPicks handles none, one and many commits", () => {
    expect(selectionFromPicks(commits, [], "net")).toEqual({ kind: "pending" });
    expect(selectionFromPicks(commits, [c2.hash], "net")).toEqual({
      kind: "commit",
      commit: c2,
    });

    const contiguous = selectionFromPicks(commits, [c3.hash, c2.hash], "net");
    expect(contiguous.kind).toBe("commits");
    if (contiguous.kind === "commits") {
      expect(contiguous.commits.map((commit) => commit.hash)).toEqual([
        c3.hash,
        c2.hash,
      ]);
      expect(contiguous.contiguous).toBe(true);
      expect(contiguous.mode).toBe("net");
    }

    const gapped = selectionFromPicks(commits, [c3.hash, c1.hash], "net");
    expect(gapped.kind).toBe("commits");
    if (gapped.kind === "commits") {
      expect(gapped.contiguous).toBe(false);
      expect(gapped.mode).toBe("stack");
    }
  });

  test("selectionFromTimeWindow filters commits and picks the mode", () => {
    const selection = selectionFromTimeWindow(windowA, commits);
    expect(selection.kind).toBe("time-window");
    if (selection.kind === "time-window") {
      expect(selection.window).toBe(windowA);
      expect(selection.commits).toHaveLength(3);
      expect(selection.contiguous).toBe(true);
      expect(selection.mode).toBe("net");
    }
  });

  test("sameTimeWindowSelection compares windows, modes and commits", () => {
    const left = selectionFromTimeWindow(windowA, commits);
    const right = selectionFromTimeWindow(windowB, commits);
    if (left.kind !== "time-window" || right.kind !== "time-window") {
      throw new Error("expected time-window selections");
    }
    expect(sameTimeWindowSelection(left, right)).toBe(true);

    const reordered = selectionFromTimeWindow(windowA, [c1, c2, c3]);
    if (reordered.kind !== "time-window") {
      throw new Error("expected time-window selection");
    }
    expect(sameTimeWindowSelection(left, reordered)).toBe(false);

    const differentMode = { ...left, mode: "stack" as const };
    expect(sameTimeWindowSelection(left, differentMode)).toBe(false);
  });
});

describe("selection cache keys", () => {
  test("selectionCacheKey is stable per kind", () => {
    expect(selectionCacheKey(undefined)).toBe("");
    expect(selectionCacheKey({ kind: "pending" })).toBe("pending");
    expect(selectionCacheKey({ kind: "commit", commit: c1 })).toBe(
      `commit:${c1.hash}`,
    );
    expect(
      selectionCacheKey({
        kind: "commits",
        commits: [c3, c2],
        mode: "stack",
        contiguous: true,
      }),
    ).toBe(`commits:stack:${c3.hash},${c2.hash}`);
    expect(
      selectionCacheKey({
        kind: "time-window",
        window: windowA,
        commits,
        mode: "net",
        contiguous: true,
      }),
    ).toBe(`time-window:${windowA.start}:${windowA.end}:net`);
    expect(
      selectionCacheKey({
        kind: "branch",
        branch,
        baseBranch: { name: "main", ref: "refs/heads/main" },
      }),
    ).toBe("branch:feature");
  });

  test("fullFileCacheKey separates selection, path and rev", () => {
    expect(fullFileCacheKey("pending", "src/a.ts", "abc")).toBe(
      "pending\u0000src/a.ts\u0000abc",
    );
    expect(fullFileCacheKey("pending", "src/a.ts", undefined)).toBe(
      "pending\u0000src/a.ts\u0000",
    );
  });
});

describe("Change Set helpers", () => {
  test("setChangeFileReviewState updates a matching file without mutating", () => {
    const a = makeFile("src/a.ts");
    const b = makeFile("src/b.ts");
    const changeSet: ChangeSet = {
      selection: { kind: "pending" },
      worktree: { path: "/repo", branch: "main" },
      files: [a, b],
      totals: { files: 2, additions: 2, deletions: 2 },
    };

    const updated = setChangeFileReviewState(
      changeSet,
      a.path,
      a.contentHash,
      true,
    );
    expect(updated.files[0]?.reviewed).toBe(true);
    expect(updated.files[1]).toBe(b);
    expect(changeSet.files[0]?.reviewed).toBeUndefined();
    expect(updated.totals).toBe(changeSet.totals);
  });

  test("setChangeFileReviewState updates every commit group", () => {
    const a = makeFile("src/a.ts");
    const changeSet: ChangeSet = {
      selection: { kind: "commit", commit: c1 },
      worktree: { path: "/repo", branch: "main" },
      files: [a],
      commitGroups: [
        {
          commit: c1,
          files: [a],
          totals: { files: 1, additions: 1, deletions: 1 },
        },
      ],
      totals: { files: 1, additions: 1, deletions: 1 },
    };

    const updated = setChangeFileReviewState(
      changeSet,
      a.path,
      a.contentHash,
      true,
    );
    expect(updated.files[0]?.reviewed).toBe(true);
    expect(updated.commitGroups?.[0]?.files[0]?.reviewed).toBe(true);
    expect(changeSet.commitGroups?.[0]?.files[0]?.reviewed).toBeUndefined();
  });

  test("replaceChangeFile matches path and revision", () => {
    const a = makeFile("src/a.ts", { newRev: "rev-a" });
    const b = makeFile("src/b.ts", { newRev: "rev-b" });
    const changeSet: ChangeSet = {
      selection: { kind: "pending" },
      worktree: { path: "/repo", branch: "main" },
      files: [a, b],
      totals: { files: 2, additions: 2, deletions: 2 },
    };
    const replacement = { ...a, collapsed: false, additions: 9 };

    const byRev = replaceChangeFile(changeSet, a.path, "rev-a", replacement);
    expect(byRev.files[0]).toBe(replacement);
    expect(byRev.files[1]).toBe(b);

    const mismatched = replaceChangeFile(
      changeSet,
      a.path,
      "other-rev",
      replacement,
    );
    expect(mismatched.files[0]).toBe(a);
  });
});

describe("filter and list helpers", () => {
  test("activeFilterSummary describes the active filters", () => {
    expect(activeFilterSummary(undefined)).toBe("none");
    expect(
      activeFilterSummary({
        disabledExtensions: [],
        includeGlobs: [],
        excludeGlobs: [],
        hideNoise: false,
      }),
    ).toBe("none");
    expect(
      activeFilterSummary({
        disabledExtensions: [".ts", ""],
        includeGlobs: ["src/**"],
        excludeGlobs: ["**/*.snap", "dist/**"],
        hideNoise: true,
      }),
    ).toBe("noise on · .ts, (no extension) off · include 1 · exclude 2");
  });

  test("hiddenFilesLabel pluralizes", () => {
    expect(hiddenFilesLabel(1)).toBe("1 file hidden");
    expect(hiddenFilesLabel(3)).toBe("3 files hidden");
  });

  test("splitGlobLines trims, splits and drops blanks", () => {
    expect(splitGlobLines("src/**\r\n\n  **/*.ts  \n")).toEqual([
      "src/**",
      "**/*.ts",
    ]);
  });

  test("stack helpers build stable ids, keys and indices", () => {
    expect(stackFileId("abc123", "src/a b.ts")).toBe(
      "stack-abc123-src-a-b-ts",
    );
    expect(stackFileKey("abc123", "src/a.ts")).toBe("abc123:src/a.ts");

    const a = makeFile("src/a.ts");
    const b = makeFile("src/b.ts");
    const c = makeFile("src/c.ts");
    const indices = stackFileIndices([
      {
        commit: c3,
        files: [a, b],
        totals: { files: 2, additions: 2, deletions: 2 },
      },
      {
        commit: c2,
        files: [c],
        totals: { files: 1, additions: 1, deletions: 1 },
      },
    ]);
    expect(indices.get(stackFileKey(c3.hash, a.path))).toBe(0);
    expect(indices.get(stackFileKey(c3.hash, b.path))).toBe(1);
    expect(indices.get(stackFileKey(c2.hash, c.path))).toBe(2);
  });

  test("isNotFoundError recognises 404 responses", () => {
    expect(isNotFoundError(new ApiError(404, "gone"))).toBe(true);
    expect(isNotFoundError(new ApiError(500, "nope"))).toBe(false);
    expect(isNotFoundError(new Error("404: gone"))).toBe(false);
    expect(isNotFoundError("404: gone")).toBe(false);
  });
});
