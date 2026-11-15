import { afterEach, describe, expect, test } from "bun:test";
import { buildPendingChangeSet } from "../src/changeset/pending";
import { GitGateway } from "../src/git/gateway";
import { listWorktrees } from "../src/repository/worktrees";
import type { WorktreeSummary } from "../shared/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function byPath(
  worktrees: readonly WorktreeSummary[],
  path: string,
): WorktreeSummary | undefined {
  return worktrees.find((worktree) => worktree.path === path);
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

describe("Worktrees Repository Model", () => {
  test("lists every Worktree with path, branch or detached HEAD, and Pending count", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("initial");

    const linked = repo.addWorktree("agent-a", { branch: "agent-a" });
    const detached = repo.addWorktree("agent-detached", { detach: true });

    repo.write("main-pending.txt", "one\n");
    repo.write("main-untracked.txt", "two\n");
    linked.write("linked-staged.txt", "one\n", { stage: true });
    linked.write("linked-pending.txt", "two\n");
    detached.write("detached-pending.txt", "one\n");

    const { worktrees } = await listWorktrees(
      await GitGateway.open(repo.root),
    );

    expect(worktrees).toHaveLength(3);

    const main = byPath(worktrees, repo.root);
    expect(main).toMatchObject({
      branch: "main",
      pendingCount: 2,
      current: true,
    });
    expect(main?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(main?.shortHead).toBe(main?.head.slice(0, 7));

    const linkedSummary = byPath(worktrees, linked.root);
    expect(linkedSummary).toMatchObject({
      branch: "agent-a",
      pendingCount: 2,
      current: false,
    });

    const detachedSummary = byPath(worktrees, detached.root);
    expect(detachedSummary).toMatchObject({
      branch: null,
      pendingCount: 1,
      current: false,
    });
    expect(detachedSummary?.shortHead).toBe(
      detachedSummary?.head.slice(0, 7),
    );
  });

  test("works when launched from inside a linked Worktree", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("initial");

    const linked = repo.addWorktree("agent", { branch: "agent-work" });
    linked.write("linked-only.ts", "one\n");

    const linkedGit = await GitGateway.open(linked.root);
    const { worktrees } = await listWorktrees(linkedGit);
    const current = worktrees.find((worktree) => worktree.current);

    expect(current).toMatchObject({
      path: linked.root,
      branch: "agent-work",
      pendingCount: 1,
    });

    const changeSet = await buildPendingChangeSet(linkedGit);
    expect(changeSet.worktree.path).toBe(linked.root);
    expect(changeSet.worktree.branch).toBe("agent-work");
    expect(changeSet.files.map((file) => file.path)).toEqual([
      "linked-only.ts",
    ]);
  });
});
