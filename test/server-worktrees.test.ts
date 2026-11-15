import { afterEach, describe, expect, test } from "bun:test";
import { cleanupFixtureServers } from "./helpers/server";

import { chmodSync } from "node:fs";
import type {
  BranchList,
  ChangeSet,
  CommitList,
  WorktreeList,
} from "../shared/types";
import { createFixtureRepo } from "./helpers/fixture";
import {
  getJson,
  startFixtureServer,
} from "./helpers/server";

afterEach(cleanupFixtureServers);

describe("Worktree HTTP API", () => {
  test("returns Worktrees and Pending changes for a selected Worktree", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("initial");

    const linked = repo.addWorktree("agent", { branch: "agent-work" });
    repo.write("main-pending.txt", "main\n");
    linked.write("linked-pending.ts", "linked\n");

    const running = (await startFixtureServer({ repo })).running;

    const list = await getJson<WorktreeList>(running, "/api/worktrees");
    expect(list.status).toBe(200);
    expect(list.body.worktrees).toHaveLength(2);

    const linkedSummary = list.body.worktrees.find(
      (worktree) => worktree.path === linked.root,
    );
    expect(linkedSummary).toMatchObject({
      branch: "agent-work",
      pendingCount: 1,
    });

    const pending = await getJson<ChangeSet>(
      running,
      `/api/pending?worktree=${encodeURIComponent(linked.root)}`,
    );
    expect(pending.status).toBe(200);
    expect(pending.body.worktree.path).toBe(linked.root);
    expect(pending.body.files.map((file) => file.path)).toEqual([
      "linked-pending.ts",
    ]);

    const unknown = await fetch(
      `http://127.0.0.1:${running.port}/api/pending?worktree=${encodeURIComponent(
        `${repo.root}-missing`,
      )}`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    expect(unknown.status).toBe(404);
  });

  test("Commits, Branches and Selections follow the selected Worktree", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("base");

    const linked = repo.addWorktree("agent", { branch: "agent-work" });
    linked.write("agent.ts", "one\n");
    const firstLinked = linked.commit("linked one");
    linked.write("agent.ts", "two\n");
    const secondLinked = linked.commit("linked two");

    repo.write("main.ts", "main\n");
    repo.commit("main only");

    const running = (await startFixtureServer({ repo })).running;
    const linkedQuery = `worktree=${encodeURIComponent(linked.root)}`;

    const mainCommits = await getJson<CommitList>(running, "/api/commits");
    expect(mainCommits.body.commits.map((commit) => commit.message)).toContain(
      "main only",
    );
    expect(mainCommits.body.commits.map((commit) => commit.message)).not.toContain(
      "linked one",
    );

    const linkedCommits = await getJson<CommitList>(
      running,
      `/api/commits?${linkedQuery}`,
    );
    expect(linkedCommits.body.worktree.path).toBe(linked.root);
    expect(linkedCommits.body.worktree.branch).toBe("agent-work");
    expect(linkedCommits.body.commits.map((commit) => commit.message)).toEqual(
      expect.arrayContaining(["linked two", "linked one"]),
    );
    expect(linkedCommits.body.commits.map((commit) => commit.message)).not.toContain(
      "main only",
    );

    const mainBranches = await getJson<BranchList>(running, "/api/branches");
    expect(
      mainBranches.body.branches.find((branch) => branch.name === "main")
        ?.current,
    ).toBe(true);
    expect(
      mainBranches.body.branches.find(
        (branch) => branch.name === "agent-work",
      )?.current,
    ).toBe(false);

    const linkedBranches = await getJson<BranchList>(
      running,
      `/api/branches?${linkedQuery}`,
    );
    expect(
      linkedBranches.body.branches.find(
        (branch) => branch.name === "agent-work",
      )?.current,
    ).toBe(true);
    expect(
      linkedBranches.body.branches.find((branch) => branch.name === "main")
        ?.current,
    ).toBe(false);

    const single = await getJson<ChangeSet>(
      running,
      `/api/commit?hash=${secondLinked}&${linkedQuery}`,
    );
    expect(single.status).toBe(200);
    expect(single.body.selection.kind).toBe("commit");
    expect(single.body.worktree.path).toBe(linked.root);
    expect(single.body.files.map((file) => file.path)).toEqual(["agent.ts"]);

    const multi = await getJson<ChangeSet>(
      running,
      `/api/commit-set?hashes=${secondLinked},${firstLinked}&mode=net&${linkedQuery}`,
    );
    expect(multi.status).toBe(200);
    expect(multi.body.selection.kind).toBe("commits");
    expect(multi.body.worktree.path).toBe(linked.root);
    expect(multi.body.files[0]?.diff).toContain("+two");

    const linkedCommitTimes = linkedCommits.body.commits
      .filter((commit) => commit.message.startsWith("linked"))
      .map((commit) => Date.parse(commit.committedAt));
    const start = new Date(Math.min(...linkedCommitTimes) - 30_000).toISOString();
    const end = new Date(Math.max(...linkedCommitTimes) + 30_000).toISOString();
    const timeWindow = await getJson<ChangeSet>(
      running,
      `/api/time-window?start=${encodeURIComponent(
        start,
      )}&end=${encodeURIComponent(end)}&preset=custom&mode=net&${linkedQuery}`,
    );
    expect(timeWindow.status).toBe(200);
    expect(timeWindow.body.selection.kind).toBe("time-window");
    expect(timeWindow.body.worktree.path).toBe(linked.root);
    if (timeWindow.body.selection.kind === "time-window") {
      expect(
        timeWindow.body.selection.commits.map((commit) => commit.message),
      ).toEqual(expect.arrayContaining(["linked two", "linked one"]));
    }
    expect(timeWindow.body.files.map((file) => file.path)).toEqual([
      "agent.ts",
    ]);

    const branch = await getJson<ChangeSet>(
      running,
      `/api/branch?name=agent-work&${linkedQuery}`,
    );
    expect(branch.status).toBe(200);
    expect(branch.body.selection.kind).toBe("branch");
    expect(branch.body.worktree.path).toBe(linked.root);
    expect(branch.body.files.map((file) => file.path)).toEqual(["agent.ts"]);
  });

  test("rejects unknown Worktrees and invalid Time Window parameters", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("base");

    const running = (await startFixtureServer({ repo })).running;

    const missing = await getJson<{ error: string }>(
      running,
      `/api/commits?worktree=${encodeURIComponent(`${repo.root}-missing`)}`,
    );
    expect(missing.status).toBe(404);

    const invalidWindow = await getJson<{ error: string }>(
      running,
      "/api/time-window?start=--help&end=also-bad&preset=today",
    );
    expect(invalidWindow.status).toBe(400);

    const invalidPreset = await getJson<{ error: string }>(
      running,
      `/api/time-window?start=${encodeURIComponent(
        new Date(2024, 0, 1).toISOString(),
      )}&end=${encodeURIComponent(
        new Date(2024, 0, 2).toISOString(),
      )}&preset=forever`,
    );
    expect(invalidPreset.status).toBe(400);

    const invalidMode = await getJson<{ error: string }>(
      running,
      `/api/time-window?start=${encodeURIComponent(
        new Date(2024, 0, 1).toISOString(),
      )}&end=${encodeURIComponent(
        new Date(2024, 0, 2).toISOString(),
      )}&preset=today&mode=side-by-side`,
    );
    expect(invalidMode.status).toBe(400);
  });

  test("a broken linked Worktree does not break the list", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("initial");
    const linked = repo.addWorktree("broken", { branch: "broken-work" });
    chmodSync(linked.root, 0o000);

    try {
      const running = (await startFixtureServer({ repo })).running;
      const response = await getJson<WorktreeList>(running, "/api/worktrees");
      expect(response.status).toBe(200);
      expect(
        response.body.worktrees.some((worktree) => worktree.path === linked.root),
      ).toBe(false);
      expect(
        response.body.worktrees.some((worktree) => worktree.current),
      ).toBe(true);
    } finally {
      chmodSync(linked.root, 0o755);
    }
  });

  test("ignores the worktree parameter only on the Worktrees endpoint", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("initial");

    const running = (await startFixtureServer({ repo })).running;

    const plain = await getJson<WorktreeList>(running, "/api/worktrees");
    expect(plain.status).toBe(200);

    const withBogusWorktree = await getJson<WorktreeList>(
      running,
      "/api/worktrees?worktree=%2Fnope",
    );
    expect(withBogusWorktree.status).toBe(200);
    expect(withBogusWorktree.body).toEqual(plain.body);

    // Repository routes that took the worktree parameter on main still do.
    const branches = await getJson<{ error: string }>(
      running,
      "/api/branches?worktree=%2Fnope",
    );
    expect(branches.status).toBe(404);
    const commits = await getJson<{ error: string }>(
      running,
      "/api/commits?worktree=%2Fnope",
    );
    expect(commits.status).toBe(404);
  });
});
