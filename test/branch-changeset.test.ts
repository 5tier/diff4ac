import { afterEach, describe, expect, test } from "bun:test";
import { buildBranchChangeSet } from "../src/changeset/branch";
import { GitGateway } from "../src/git/gateway";
import { UnknownBranchError } from "../src/repository/branches";
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

function divergedRepo(): {
  readonly repo: FixtureRepo;
  readonly featureTip: string;
} {
  const repo = fixture();
  repo.write("base.txt", "base\n");
  repo.commit("initial");

  repo.git(["checkout", "-q", "-b", "agent/feature-x"]);
  repo.write("base.txt", "base\nfeature\n");
  repo.write("feature.txt", "feature only\n");
  const featureTip = repo.commit("feature work");

  repo.git(["checkout", "-q", "main"]);
  repo.write("base.txt", "base\nmain\n");
  repo.write("main-only.txt", "main only\n");
  repo.commit("Base Branch moves on");

  repo.git(["checkout", "-q", "agent/feature-x"]);
  return { repo, featureTip };
}

describe("Branch Change Set", () => {
  test("diffs from merge-base with the Base Branch to the branch tip", async () => {
    const { repo, featureTip } = divergedRepo();
    const git = await GitGateway.open(repo.root);

    const changeSet = await buildBranchChangeSet(git, "agent/feature-x");

    expect(changeSet.selection.kind).toBe("branch");
    if (changeSet.selection.kind !== "branch") {
      throw new Error("expected a branch Selection");
    }
    expect(changeSet.selection.branch).toMatchObject({
      name: "agent/feature-x",
      hash: featureTip,
      current: true,
    });
    expect(changeSet.selection.baseBranch).toEqual({
      name: "main",
      ref: "main",
    });

    expect(changeSet.files.map((file) => [file.path, file.status])).toEqual([
      ["base.txt", "modified"],
      ["feature.txt", "added"],
    ]);

    const base = changeSet.files.find((file) => file.path === "base.txt");
    expect(base).toMatchObject({ additions: 1, deletions: 0 });
    expect(base?.diff).toContain("+feature");
    expect(base?.diff).not.toContain("+main");

    expect(
      changeSet.files.some((file) => file.path === "main-only.txt"),
    ).toBe(false);
    expect(changeSet.totals).toEqual({ files: 2, additions: 2, deletions: 0 });
  });

  test("selecting the Base Branch itself gives an empty Change Set", async () => {
    const { repo } = divergedRepo();
    const git = await GitGateway.open(repo.root);

    const changeSet = await buildBranchChangeSet(git, "main");

    expect(changeSet.selection.kind).toBe("branch");
    if (changeSet.selection.kind !== "branch") {
      throw new Error("expected a branch Selection");
    }
    expect(changeSet.selection.branch.name).toBe("main");
    expect(changeSet.selection.branch.current).toBe(false);
    expect(changeSet.selection.baseBranch.name).toBe("main");
    expect(changeSet.files).toEqual([]);
    expect(changeSet.totals).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  test("rejects an unknown branch", async () => {
    const { repo } = divergedRepo();

    await expect(
      buildBranchChangeSet(await GitGateway.open(repo.root), "nope"),
    ).rejects.toBeInstanceOf(UnknownBranchError);
  });
});
