import { afterEach, describe, expect, test } from "bun:test";
import {
  buildCommitsChangeSet,
  NonContiguousNetDiffError,
} from "../src/changeset/commits";
import { GitGateway } from "../src/git/gateway";
import { listCommits } from "../src/repository/commits";
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

describe("Multi-commit Selection", () => {
  test("a contiguous Selection defaults to a single Net Diff across the range", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base");
    repo.write("keep.txt", "one\n");
    repo.commit("add keep");
    repo.write("keep.txt", "two\n");
    const middle = repo.commit("edit keep");
    repo.write("keep.txt", "three\n");
    const newest = repo.commit("edit keep again");

    const changeSet = await buildCommitsChangeSet(
      await GitGateway.open(repo.root),
      [newest, middle],
      "net",
    );

    expect(changeSet.selection.kind).toBe("commits");
    if (changeSet.selection.kind !== "commits") {
      throw new Error("expected a commits Selection");
    }
    expect(changeSet.selection.commits.map((commit) => commit.hash)).toEqual([
      newest,
      middle,
    ]);
    expect(changeSet.selection.contiguous).toBe(true);
    expect(changeSet.selection.mode).toBe("net");
    expect(changeSet.commitGroups).toBeUndefined();
    expect(changeSet.files.map((file) => file.path)).toEqual(["keep.txt"]);
    expect(changeSet.files[0]?.diff).toContain("-one");
    expect(changeSet.files[0]?.diff).toContain("+three");
    expect(changeSet.files[0]?.diff).not.toContain("+two");
  });

  test("detects a non-contiguous Selection and refuses a Net Diff", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base");
    repo.write("keep.txt", "one\n");
    const oldest = repo.commit("add keep");
    repo.write("keep.txt", "two\n");
    repo.commit("edit keep");
    repo.write("keep.txt", "three\n");
    const newest = repo.commit("edit keep again");

    const git = await GitGateway.open(repo.root);

    await expect(
      buildCommitsChangeSet(git, [newest, oldest], "net"),
    ).rejects.toBeInstanceOf(NonContiguousNetDiffError);

    const stack = await buildCommitsChangeSet(git, [newest, oldest], "stack");
    expect(stack.selection.kind).toBe("commits");
    if (stack.selection.kind !== "commits") {
      throw new Error("expected a commits Selection");
    }
    expect(stack.selection.contiguous).toBe(false);
    expect(stack.selection.mode).toBe("stack");
    expect(stack.commitGroups?.map((group) => group.commit.hash)).toEqual([
      oldest,
      newest,
    ]);
  });

  test("a written-then-reverted file is absent from the Net Diff but visible in the Commit Stack", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base");
    repo.write("temp.txt", "temporary\n");
    const wrote = repo.commit("add temp");
    repo.remove("temp.txt");
    const reverted = repo.commit("remove temp");

    const git = await GitGateway.open(repo.root);

    const net = await buildCommitsChangeSet(git, [reverted, wrote], "net");
    expect(net.selection.kind).toBe("commits");
    if (net.selection.kind !== "commits") {
      throw new Error("expected a commits Selection");
    }
    expect(net.selection.contiguous).toBe(true);
    expect(net.files).toEqual([]);
    expect(net.totals).toEqual({ files: 0, additions: 0, deletions: 0 });

    const stack = await buildCommitsChangeSet(git, [reverted, wrote], "stack");
    expect(stack.commitGroups).toHaveLength(2);
    expect(
      stack.commitGroups?.map((group) => group.commit.message),
    ).toEqual(["add temp", "remove temp"]);

    const added = stack.commitGroups?.[0]?.files.find(
      (file) => file.path === "temp.txt",
    );
    expect(added).toMatchObject({ status: "added", additions: 1 });

    const deleted = stack.commitGroups?.[1]?.files.find(
      (file) => file.path === "temp.txt",
    );
    expect(deleted).toMatchObject({ status: "deleted", deletions: 1 });
    expect(stack.totals.files).toBe(2);
  });
});

describe("Contiguity with merges", () => {
  test("sibling commits adjacent in the list are not a first-parent chain", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    const base = repo.commit("base");

    repo.git(["checkout", "-q", "-b", "sibling-a"]);
    repo.write("a.txt", "a\n");
    const siblingA = repo.commit("sibling a");

    repo.git(["checkout", "-q", "main"]);
    repo.git(["checkout", "-q", "-b", "sibling-b"]);
    repo.write("b.txt", "b\n");
    const siblingB = repo.commit("sibling b");

    repo.git(["checkout", "-q", "sibling-a"]);
    repo.git(["merge", "--no-ff", "-m", "merge siblings", "sibling-b"]);

    const git = await GitGateway.open(repo.root);
    const list = await listCommits(git);
    const aIndex = list.commits.findIndex((commit) => commit.hash === siblingA);
    const bIndex = list.commits.findIndex((commit) => commit.hash === siblingB);

    expect(Math.abs(aIndex - bIndex)).toBe(1);
    expect(list.commits[aIndex]?.firstParent).toBe(base);
    expect(list.commits[bIndex]?.firstParent).toBe(base);

    await expect(
      buildCommitsChangeSet(git, [siblingA, siblingB], "net"),
    ).rejects.toBeInstanceOf(NonContiguousNetDiffError);

    const stack = await buildCommitsChangeSet(
      git,
      [siblingA, siblingB],
      "stack",
    );
    expect(stack.selection.kind).toBe("commits");
    if (stack.selection.kind !== "commits") {
      throw new Error("expected a commits Selection");
    }
    expect(stack.selection.contiguous).toBe(false);
    expect(stack.selection.mode).toBe("stack");

    const chain = await buildCommitsChangeSet(
      git,
      [siblingA, base],
      "net",
    );
    expect(chain.selection.kind).toBe("commits");
    if (chain.selection.kind !== "commits") {
      throw new Error("expected a commits Selection");
    }
    expect(chain.selection.contiguous).toBe(true);
    expect(chain.selection.mode).toBe("net");
  });
});
