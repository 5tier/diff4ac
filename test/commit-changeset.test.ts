import { afterEach, describe, expect, test } from "bun:test";
import { buildCommitChangeSet } from "../src/changeset/commit";
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

describe("Single-commit Change Set", () => {
  test("diffs a commit against its parent and selects it", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    const first = repo.commit("initial");
    repo.write("src/app.ts", "one\ntwo\n");
    repo.write("src/new.ts", "fresh\n");
    const second = repo.commit("second");
    repo.write("src/app.ts", "one\ntwo\nthree\n");
    repo.remove("src/new.ts");
    repo.commit("third");

    const git = await GitGateway.open(repo.root);
    const changeSet = await buildCommitChangeSet(git, second);

    expect(changeSet.selection.kind).toBe("commit");
    if (changeSet.selection.kind !== "commit") {
      throw new Error("expected a commit Selection");
    }
    expect(changeSet.selection.commit.hash).toBe(second);
    expect(changeSet.selection.commit.message).toBe("second");
    expect(changeSet.worktree.branch).toBe("main");
    expect(changeSet.files.map((file) => [file.path, file.status])).toEqual([
      ["src/app.ts", "modified"],
      ["src/new.ts", "added"],
    ]);

    const app = changeSet.files.find((file) => file.path === "src/app.ts");
    expect(app).toMatchObject({ additions: 1, deletions: 0, binary: false });
    expect(app?.diff).toContain("+two");
    expect(app?.diff).not.toContain("+three");
    expect(app?.hunks).toHaveLength(1);

    const added = changeSet.files.find((file) => file.path === "src/new.ts");
    expect(added).toMatchObject({ additions: 1, deletions: 0 });
    expect(added?.diff).toContain("+fresh");

    expect(changeSet.totals).toEqual({ files: 2, additions: 2, deletions: 0 });
    expect(first).not.toBe(second);
  });

  test("shows a root commit as all files added", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.write("src/app.ts", "one\ntwo\n");
    const root = repo.commit("root commit");
    repo.write("src/app.ts", "one\ntwo\nthree\n");
    repo.commit("later");

    const git = await GitGateway.open(repo.root);
    const changeSet = await buildCommitChangeSet(git, root);

    expect(changeSet.selection.kind).toBe("commit");
    expect(changeSet.files.map((file) => [file.path, file.status])).toEqual([
      ["README.md", "added"],
      ["src/app.ts", "added"],
    ]);
    expect(changeSet.files[0]?.diff).toContain("+hello");
    expect(changeSet.files[1]?.diff).toContain("+two");
    expect(changeSet.files[1]?.diff).not.toContain("+three");
    expect(changeSet.totals).toEqual({ files: 2, additions: 3, deletions: 0 });
  });
});
