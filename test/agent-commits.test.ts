import { afterEach, describe, expect, test } from "bun:test";
import { cleanupFixtureServers } from "./helpers/server";

import type { RunningServer } from "../src/server/server";
import type { ChangeSet, CommitList } from "../shared/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import {
  getJson as getJsonResponse,
  startFixtureServer,
} from "./helpers/server";

afterEach(cleanupFixtureServers);

function fixture(): FixtureRepo {
  return createFixtureRepo();
}

async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<T> {
  const response = await getJsonResponse<T>(running, path);
  expect(response.status).toBe(200);
  return response.body;
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

    const running = (await startFixtureServer({ repo })).running;

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

    const running = (await startFixtureServer({ repo })).running;

    const list = await getJson<CommitList>(running, "/api/commits");
    expect(list.commits[0]?.agent).toBe("Helper");
  });
});
