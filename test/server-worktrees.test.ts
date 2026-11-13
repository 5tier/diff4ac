import { afterEach, describe, expect, test } from "bun:test";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeSet, WorktreeList } from "../src/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];
const servers: RunningServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    headers: { "x-diff4ac-token": running.token },
  });
  return {
    status: response.status,
    body: (await response.json()) as T,
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

    const running = await startServer({ repoPath: repo.root });
    servers.push(running);

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
});
