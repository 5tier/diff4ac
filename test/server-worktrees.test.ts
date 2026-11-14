import { afterEach, describe, expect, test } from "bun:test";
import { startServer, type RunningServer } from "../src/server/server";
import type {
  BranchList,
  ChangeSet,
  CommitList,
  WorktreeList,
} from "../src/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { createTempHome, type TempHome } from "./helpers/home";

const repos: FixtureRepo[] = [];
const servers: RunningServer[] = [];
const homes: TempHome[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
  for (const home of homes.splice(0)) {
    home.dispose();
  }
});

async function startFixtureServer(repo: FixtureRepo): Promise<RunningServer> {
  const home = createTempHome();
  homes.push(home);
  const running = await startServer({ repoPath: repo.root, homeDir: home.path });
  servers.push(running);
  return running;
}

async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    headers: { "x-diff4ac-token": running.token },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body: body as T,
  };
}

describe("Worktree HTTP API", () => {
  test("returns Worktrees and Pending changes for a selected Worktree", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    repo.write("base.txt", "base\n");
    repo.commit("initial");

    const linked = repo.addWorktree("agent", { branch: "agent-work" });
    repo.write("main-pending.txt", "main\n");
    linked.write("linked-pending.ts", "linked\n");

    const running = await startFixtureServer(repo);

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
    repos.push(repo);
    repo.write("base.txt", "base\n");
    repo.commit("base");

    const linked = repo.addWorktree("agent", { branch: "agent-work" });
    linked.write("agent.ts", "one\n");
    const firstLinked = linked.commit("linked one");
    linked.write("agent.ts", "two\n");
    const secondLinked = linked.commit("linked two");

    repo.write("main.ts", "main\n");
    repo.commit("main only");

    const running = await startFixtureServer(repo);
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
    repos.push(repo);
    repo.write("base.txt", "base\n");
    repo.commit("base");

    const running = await startFixtureServer(repo);

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
});
