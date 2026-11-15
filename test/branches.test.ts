import { afterEach, describe, expect, test } from "bun:test";
import { GitGateway } from "../src/git/gateway";
import {
  detectBaseBranch,
  listBranches,
  requireBaseBranch,
  UnknownBranchError,
} from "../src/repository/branches";
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

describe("Branches and Base Branch", () => {
  test("lists local branches newest-independent and marks the current one", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.git(["checkout", "-q", "-b", "agent/feature-x"]);
    repo.write("feature.txt", "feature\n");
    const featureTip = repo.commit("feature work");

    const list = await listBranches(await GitGateway.open(repo.root));

    expect(list.worktree.branch).toBe("agent/feature-x");
    expect(list.baseBranch).toEqual({ name: "main", ref: "main" });
    expect(list.branches.map((branch) => branch.name)).toEqual([
      "agent/feature-x",
      "main",
    ]);

    const feature = list.branches.find(
      (branch) => branch.name === "agent/feature-x",
    );
    expect(feature).toMatchObject({ hash: featureTip, current: true });
    expect(feature?.hash.startsWith(feature?.shortHash ?? "")).toBe(true);

    const main = list.branches.find((branch) => branch.name === "main");
    expect(main?.current).toBe(false);
  });

  test("prefers the branch pointed to by origin/HEAD", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.git(["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
    repo.git([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    ]);

    const base = await detectBaseBranch(await GitGateway.open(repo.root));

    expect(base).toEqual({ name: "trunk", ref: "origin/trunk" });
  });

  test("uses the local branch named by origin/HEAD when it exists", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    repo.git([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);

    const base = await detectBaseBranch(await GitGateway.open(repo.root));

    expect(base).toEqual({ name: "main", ref: "main" });
  });

  test("falls back to master when main is absent", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.git(["branch", "-m", "master"]);

    const base = await detectBaseBranch(await GitGateway.open(repo.root));

    expect(base).toEqual({ name: "master", ref: "master" });
  });

  test("reports no Base Branch when none of the candidates exist", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.git(["branch", "-m", "topic"]);

    const base = await detectBaseBranch(await GitGateway.open(repo.root));

    expect(base).toBeNull();
  });

  test("falls back when the configured Base Branch is missing", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");

    const base = await detectBaseBranch(
      await GitGateway.open(repo.root),
      "missing",
    );

    expect(base).toEqual({ name: "main", ref: "main" });
  });

  test("requireBaseBranch rejects a missing configured Base Branch", async () => {
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");

    await expect(
      requireBaseBranch(await GitGateway.open(repo.root), "missing"),
    ).rejects.toBeInstanceOf(UnknownBranchError);
  });
});
