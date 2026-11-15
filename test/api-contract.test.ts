import { afterEach, describe, expect, test } from "bun:test";
import {
  guardBranchList,
  guardChangeFile,
  guardChangeSet,
  guardCommitList,
  guardConfigInfo,
  guardReviewMarkRequest,
  guardReviewMarkResponse,
  guardSelection,
  guardSessionInfo,
  guardSnapshotFile,
  guardSnapshotPathMatches,
  guardSnapshotTree,
  guardWorktreeList,
  isArrayOf,
  isOptional,
  isString,
  type Guard,
} from "../shared/api-contract";
import type {
  BranchList,
  ChangeFile,
  ChangeSet,
  CommitList,
  CommitSummary,
  ConfigInfo,
  SessionInfo,
  WorktreeList,
} from "../shared/types";
import { fetchPending } from "../web/api";
import { ApiError } from "../web/api-error";
import {
  createFixtureRepo,
  type FixtureRepo,
} from "./helpers/fixture";
import { getJson, startFixtureServer } from "./helpers/server";

const repos: FixtureRepo[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

const COMMIT: CommitSummary = {
  hash: "a".repeat(40),
  shortHash: "aaaaaaa",
  message: "a commit",
  author: { name: "Fixture", email: "fixture@example.com" },
  committedAt: "2024-01-01T12:00:00.000Z",
  relativeDate: "2 years ago",
  firstParent: null,
  agent: null,
};

const CHANGE_FILE: ChangeFile = {
  path: "src/app.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  binary: false,
  diff: "@@ -1 +1 @@\n-one\n+two\n",
  hunks: [
    {
      header: "@@ -1 +1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { type: "delete", content: "one", oldLine: 1, newLine: null },
        { type: "add", content: "two", oldLine: null, newLine: 1 },
      ],
    },
  ],
  contentHash: "b".repeat(40),
  oldRev: "c".repeat(40),
  newRev: "worktree",
};

const CHANGE_SET: ChangeSet = {
  selection: { kind: "pending" },
  worktree: { path: "/repo", branch: "main" },
  files: [CHANGE_FILE],
  totals: { files: 1, additions: 1, deletions: 1 },
};

const COMMIT_LIST: CommitList = {
  worktree: { path: "/repo", branch: "main" },
  commits: [COMMIT],
  hasMore: false,
};

const BRANCH_LIST: BranchList = {
  worktree: { path: "/repo", branch: "main" },
  baseBranch: { name: "main", ref: "main" },
  branches: [
    { name: "main", hash: COMMIT.hash, shortHash: COMMIT.shortHash, current: true },
  ],
};

const WORKTREE_LIST: WorktreeList = {
  worktrees: [
    {
      path: "/repo",
      branch: "main",
      head: COMMIT.hash,
      shortHead: COMMIT.shortHash,
      pendingCount: 0,
      current: true,
    },
  ],
};

const CONFIG: ConfigInfo = {
  baseBranch: null,
  keybindings: {},
  agents: [],
  noise: ["**/*.lock"],
  theme: "system",
  diagnostics: [],
};

const SESSION: SessionInfo = {
  worktree: { path: "/repo", branch: "main" },
  version: "1.2.3",
};

function expectGuard<T>(guard: Guard<T>, value: unknown, path = ""): T {
  const result = guard(value, path);
  if (!result.ok) {
    throw new Error(`${result.path || "response"} is not ${result.expected}`);
  }
  return result.value;
}

function expectFailure<T>(
  guard: Guard<T>,
  value: unknown,
  path: string,
  expected: string,
): void {
  const result = guard(value, "");
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.path).toBe(path);
  expect(result.expected).toBe(expected);
}

describe("API contract guards", () => {
  test("accept valid samples and tolerate extra fields", () => {
    expectGuard(guardChangeSet, {
      ...CHANGE_SET,
      files: [{ ...CHANGE_FILE, extra: true }],
      extra: "ignored",
    });
    expectGuard(guardCommitList, COMMIT_LIST);
    expectGuard(guardBranchList, BRANCH_LIST);
    expectGuard(guardWorktreeList, WORKTREE_LIST);
    expectGuard(guardConfigInfo, CONFIG);
    expectGuard(guardSessionInfo, SESSION);
    expectGuard(guardReviewMarkResponse, {
      path: "src/app.ts",
      contentHash: CHANGE_FILE.contentHash,
      reviewed: true,
    });
    expectGuard(guardReviewMarkRequest, {
      path: "src/app.ts",
      contentHash: CHANGE_FILE.contentHash,
      reviewed: true,
    });
    expectGuard(guardSnapshotTree, [
      {
        name: "app.ts",
        path: "src/app.ts",
        kind: "file",
        status: "modified",
      },
      {
        name: "src",
        path: "src",
        kind: "dir",
        containsChanges: true,
        noise: false,
      },
    ]);
    expectGuard(guardSnapshotFile, {
      path: "src/app.ts",
      kind: "file",
      size: 3,
      binary: false,
      image: false,
      text: "one",
      totalLines: 1,
    });
    expectGuard(guardSnapshotPathMatches, [
      { path: "src/app.ts", status: "modified" },
    ]);
  });

  test("reports the first failing field path", () => {
    expectFailure(
      guardChangeSet,
      {
        ...CHANGE_SET,
        files: [{ ...CHANGE_FILE, hunks: "nope" }],
      },
      "files[0].hunks",
      "an array",
    );
    expectFailure(
      guardCommitList,
      { ...COMMIT_LIST, hasMore: undefined },
      "hasMore",
      "a boolean",
    );
    expectFailure(
      guardConfigInfo,
      { ...CONFIG, keybindings: { "global.help": 3 } },
      "keybindings.global.help",
      "a string",
    );
    expectFailure(
      guardSelection,
      { kind: "wat" },
      "kind",
      "one of pending, commit, commits, time-window, branch",
    );
    expectFailure(
      guardReviewMarkRequest,
      { path: "a", contentHash: "b", reviewed: "yes" },
      "reviewed",
      "a boolean",
    );
    expectFailure(
      guardBranchList,
      { ...BRANCH_LIST, branches: "nope" },
      "branches",
      "an array",
    );
    expectFailure(
      guardWorktreeList,
      {
        ...WORKTREE_LIST,
        worktrees: [{ ...WORKTREE_LIST.worktrees[0], current: "yes" }],
      },
      "worktrees[0].current",
      "a boolean",
    );
    expectFailure(
      guardSessionInfo,
      { ...SESSION, version: 3 },
      "version",
      "a string",
    );
    expectFailure(
      guardReviewMarkResponse,
      { path: "a", reviewed: true },
      "contentHash",
      "a string",
    );
    expectFailure(
      guardSnapshotFile,
      { path: "a", kind: "file", binary: false, image: false },
      "size",
      "a number",
    );
    expectFailure(
      guardSnapshotTree,
      [{ name: "a", path: "a", kind: "wat" }],
      "[0].kind",
      "one of dir, file, symlink, submodule",
    );
  });

  test("web getJson throws a contract ApiError naming the endpoint and path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        ...CHANGE_SET,
        files: [{ ...CHANGE_FILE, hunks: "nope" }],
      })) as unknown as typeof fetch;

    try {
      const error = await fetchPending().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      if (!(error instanceof ApiError)) {
        return;
      }
      expect(error.status).toBe(0);
      expect(error.kind).toBe("contract");
      expect(error.message).toBe(
        "0: /api/pending: files[0].hunks is not an array",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("helper predicates are reusable", () => {
    expect(isString("x")).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isArrayOf([1, 2], (item): item is number => typeof item === "number")).toBe(
      true,
    );
    expect(isArrayOf([1, "2"], (item): item is number => typeof item === "number")).toBe(
      false,
    );
    expect(isOptional(undefined, isString)).toBe(true);
    expect(isOptional("x", isString)).toBe(true);
    expect(isOptional(1, isString)).toBe(false);
  });
});

function buffer(...values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("live API contract", () => {
  test("every JSON endpoint satisfies its guard across representative Selections", async () => {
    const repo = fixture();
    repo.write("src/base.ts", "base\n");
    repo.write("src/move-old.ts", "alpha\nbeta\ngamma\ndelta\n");
    repo.write("assets/icon.png", buffer(0, 1, 2, 3));
    const initial = repo.commit("initial");

    repo.git(["checkout", "-q", "-b", "feature"]);
    repo.write("src/feature.ts", "feature\n");
    const feature = repo.commit("feature work");

    repo.git(["checkout", "-q", "main"]);
    repo.write("src/base.ts", "base\nchanged\n");
    repo.write("assets/icon.png", buffer(0, 9, 8, 7, 6));
    const second = repo.commit("second");

    repo.write("src/base.ts", "base\nchanged\npending\n");
    repo.write("assets/icon.png", buffer(0, 7, 7, 7, 7));
    repo.rename("src/move-old.ts", "src/move-new.ts");
    repo.write("src/untracked.ts", "untracked\n");

    const running = (
      await startFixtureServer({ repo, commitPageSize: 2 })
    ).running;

    const checkJson = async <T>(
      path: string,
      guard: Guard<T>,
    ): Promise<T> => {
      const response = await getJson<unknown>(running, path);
      if (response.status !== 200) {
        throw new Error(`${path}: HTTP ${response.status}`);
      }
      const result = guard(response.body, "");
      if (!result.ok) {
        throw new Error(
          `${path}: ${result.path || "response"} is not ${result.expected}`,
        );
      }
      return result.value;
    };

    const pending = await checkJson("/api/pending", guardChangeSet);
    expect(pending.files.some((file) => file.status === "untracked")).toBe(true);
    expect(pending.files.some((file) => file.path === "src/move-new.ts")).toBe(
      true,
    );
    expect(pending.files.some((file) => file.image === true)).toBe(true);

    await checkJson(`/api/commit?hash=${second}`, guardChangeSet);
    await checkJson(
      `/api/commit-set?hashes=${second}&mode=net`,
      guardChangeSet,
    );
    await checkJson(
      `/api/commit-set?hashes=${second},${initial}&mode=stack`,
      guardChangeSet,
    );
    await checkJson(
      `/api/time-window?start=${encodeURIComponent(
        "2024-01-01T00:00:00.000Z",
      )}&end=${encodeURIComponent(
        "2024-01-03T00:00:00.000Z",
      )}&preset=custom&mode=auto`,
      guardChangeSet,
    );
    await checkJson("/api/branch?name=feature", guardChangeSet);
    await checkJson("/api/worktrees", guardWorktreeList);
    await checkJson("/api/branches", guardBranchList);
    await checkJson("/api/commits", guardCommitList);
    await checkJson("/api/commits?skip=1", guardCommitList);
    await checkJson("/api/config", guardConfigInfo);
    await checkJson("/api/session", guardSessionInfo);
    await checkJson(
      "/api/snapshot/tree?selection=pending&side=after&dir=src",
      guardSnapshotTree,
    );
    await checkJson(
      `/api/snapshot/tree?selection=commit&hash=${second}&side=before`,
      guardSnapshotTree,
    );
    await checkJson(
      "/api/snapshot/file?selection=pending&side=after&path=src%2Fbase.ts",
      guardSnapshotFile,
    );
    await checkJson(
      "/api/snapshot/paths?selection=pending&side=after&q=base&limit=5",
      guardSnapshotPathMatches,
    );
    const file = await checkJson(
      "/api/file-diff?selection=pending&path=src%2Fbase.ts&rev=worktree",
      guardChangeFile,
    );
    expect(file.path).toBe("src/base.ts");

    // Feature branch hash is reachable but not on main: still a valid commit.
    expect(feature).not.toBe(initial);
  }, 60_000);
});
