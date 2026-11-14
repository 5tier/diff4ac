import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeSet, CommitList } from "../src/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];
const servers: RunningServer[] = [];
const homes: string[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function home(): string {
  const directory = mkdtempSync(join(tmpdir(), "diff4ac-agent-home-"));
  homes.push(directory);
  return directory;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
  for (const directory of homes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    headers: { "x-diff4ac-token": running.token },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

describe("Agent Commit HTTP API", () => {
  test("annotates commits and filters a Time Window by Agent", async () => {
    const repo = fixture();
    repo.write("one.txt", "one\n");
    repo.commit("human one");

    repo.write("two.txt", "two\n");
    repo.commit("claude one", {
      trailers: [
        "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      ],
    });

    repo.write("three.txt", "three\n");
    repo.commit("human two");

    repo.write("four.txt", "four\n");
    repo.commit("claude two", {
      trailers: ["Co-Authored-By: Claude <noreply@anthropic.com>"],
    });

    repo.write("five.txt", "five\n");
    repo.commit("human three");

    const running = await startServer({
      repoPath: repo.root,
      homeDir: home(),
      stateDir: join(home(), ".diff4ac"),
    });
    servers.push(running);

    const all = await getJson<CommitList>(running, "/api/commits");
    expect(
      all.commits.map((commit) => [commit.message, commit.agent]),
    ).toEqual([
      ["human three", null],
      ["claude two", "Claude Code"],
      ["human two", null],
      ["claude one", "Claude Code"],
      ["human one", null],
    ]);

    const filtered = await getJson<CommitList>(
      running,
      `/api/commits?agent=${encodeURIComponent("Claude Code")}`,
    );
    expect(filtered.commits.map((commit) => commit.message)).toEqual([
      "claude two",
      "claude one",
    ]);

    const query = new URLSearchParams({
      start: "2024-01-01T12:00:00.000Z",
      end: "2024-01-01T13:00:00.000Z",
      preset: "custom",
      mode: "auto",
      agent: "Claude Code",
    });
    const window = await getJson<ChangeSet>(
      running,
      `/api/time-window?${query.toString()}`,
    );

    expect(window.selection.kind).toBe("time-window");
    if (window.selection.kind !== "time-window") {
      throw new Error("expected a time-window Selection");
    }
    expect(window.selection.commits.map((commit) => commit.message)).toEqual([
      "claude two",
      "claude one",
    ]);
    expect(window.selection.contiguous).toBe(false);
    expect(window.selection.mode).toBe("stack");
    expect(
      window.commitGroups?.map((group) => group.commit.message),
    ).toEqual(["claude one", "claude two"]);
  });

  test("uses custom Agent patterns from config", async () => {
    const repo = fixture();
    repo.write("one.txt", "one\n");
    repo.commit("helper commit", {
      trailers: ["Co-Authored-By: Helper <helper@example.com>"],
    });

    const tempHome = home();
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({
        agents: {
          Helper: {
            trailers: ["Co-Authored-By:\\s*Helper"],
          },
        },
      })}\n`,
    );

    const running = await startServer({
      repoPath: repo.root,
      homeDir: tempHome,
      stateDir: join(tempHome, ".diff4ac"),
    });
    servers.push(running);

    const list = await getJson<CommitList>(running, "/api/commits");
    expect(list.commits[0]?.agent).toBe("Helper");
  });
});
