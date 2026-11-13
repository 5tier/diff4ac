import { afterEach, describe, expect, test } from "bun:test";
import { buildPendingChangeSet } from "../src/changeset/pending";
import { GitGateway } from "../src/git/gateway";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

describe("Pending Change Set", () => {
  test("covers staged and unstaged changes against HEAD", async () => {
    const repo = fixture();
    repo.write("src/modified.ts", "one\ntwo\n");
    repo.write("src/unstaged.ts", "one\n");
    repo.write("src/deleted.ts", "bye\n");
    repo.commit("initial");

    repo.write("src/modified.ts", "one\nTWO\n");
    repo.stage("src/modified.ts");
    repo.write("src/added.ts", "fresh\n", { stage: true });
    repo.write("src/unstaged.ts", "one\nmore\n");
    repo.remove("src/deleted.ts");
    repo.write("src/untracked.ts", "new\nfile\n");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );

    expect(changeSet.selection).toEqual({ kind: "pending" });
    expect(changeSet.worktree.branch).toBe("main");

    const files = new Map(changeSet.files.map((file) => [file.path, file]));

    expect(files.get("src/modified.ts")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 1,
    });
    expect(files.get("src/modified.ts")?.diff).toContain("-two");
    expect(files.get("src/modified.ts")?.diff).toContain("+TWO");

    expect(files.get("src/added.ts")).toMatchObject({
      status: "added",
      additions: 1,
      deletions: 0,
    });

    expect(files.get("src/unstaged.ts")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 0,
    });

    expect(files.get("src/deleted.ts")).toMatchObject({
      status: "deleted",
      additions: 0,
      deletions: 1,
    });

    expect(files.get("src/untracked.ts")).toMatchObject({
      status: "untracked",
      additions: 2,
      deletions: 0,
    });
    expect(files.get("src/untracked.ts")?.diff).toContain("+new");

    expect(changeSet.files.map((file) => file.path)).toEqual([
      "src/added.ts",
      "src/deleted.ts",
      "src/modified.ts",
      "src/unstaged.ts",
      "src/untracked.ts",
    ]);
    expect(changeSet.totals).toEqual({
      files: 5,
      additions: 5,
      deletions: 2,
    });
  });

  test("returns an empty Change Set for a clean Worktree", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );

    expect(changeSet.files).toEqual([]);
    expect(changeSet.totals).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  test("does not treat binary-looking text inside an untracked file as binary", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.write(
      "src/tricky.txt",
      "first\nBinary files a and b differ\nlast\n",
    );

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files.find(
      (candidate) => candidate.path === "src/tricky.txt",
    );

    expect(file).toMatchObject({
      status: "untracked",
      binary: false,
      additions: 3,
      deletions: 0,
    });
    expect(file?.hunks).toHaveLength(1);
    expect(file?.diff).toContain("+Binary files a and b differ");
  });

  test("still reports a genuinely binary untracked file as binary", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.write("assets/icon.bin", "x\0y\n");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files.find(
      (candidate) => candidate.path === "assets/icon.bin",
    );

    expect(file).toMatchObject({
      status: "untracked",
      binary: true,
      additions: 0,
      deletions: 0,
    });
    expect(file?.hunks).toEqual([]);
  });

  test("parses hunks with old and new line numbers", async () => {
    const repo = fixture();
    repo.write("app.ts", "alpha\nbeta\ngamma\n");
    repo.commit("initial");
    repo.write("app.ts", "alpha\nBETA\ngamma\n");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files[0];

    expect(file?.hunks).toHaveLength(1);
    const hunk = file?.hunks[0];
    expect(hunk).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(hunk?.lines.map((line) => line.type)).toEqual([
      "context",
      "delete",
      "add",
      "context",
    ]);
    expect(hunk?.lines.map((line) => line.content)).toEqual([
      "alpha",
      "beta",
      "BETA",
      "gamma",
    ]);
  });
});
