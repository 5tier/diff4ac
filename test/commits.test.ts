import { afterEach, describe, expect, test } from "bun:test";
import { GitGateway } from "../src/git/gateway";
import { listCommits, relativeDate } from "../src/repository/commits";
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

describe("Commit list", () => {
  test("lists commits on the current branch newest first with message, author, relative date and short hash", async () => {
    const repo = fixture();
    repo.write("a.txt", "one\n");
    const first = repo.commit("initial commit");
    repo.write("b.txt", "two\n");
    const second = repo.commit("add b", {
      author: { name: "Claude Code", email: "noreply@anthropic.com" },
    });
    repo.write("c.txt", "three\n");
    const third = repo.commit("add c");

    const list = await listCommits(await GitGateway.open(repo.root), {
      now: new Date("2024-01-01T12:03:00.000Z"),
    });

    expect(list.worktree.branch).toBe("main");
    expect(list.commits.map((commit) => commit.message)).toEqual([
      "add c",
      "add b",
      "initial commit",
    ]);
    expect(list.commits.map((commit) => commit.hash)).toEqual([
      third,
      second,
      first,
    ]);

    expect(list.commits[2]).toMatchObject({
      message: "initial commit",
      author: { name: "Fixture Author", email: "fixture@example.com" },
      relativeDate: "2 minutes ago",
    });
    expect(list.commits[1]?.author).toEqual({
      name: "Claude Code",
      email: "noreply@anthropic.com",
    });
    expect(list.commits[1]?.relativeDate).toBe("1 minute ago");
    expect(list.commits[0]?.relativeDate).toBe("just now");

    for (const commit of list.commits) {
      expect(commit.hash.startsWith(commit.shortHash)).toBe(true);
      expect(commit.shortHash.length).toBeLessThan(commit.hash.length);
      expect(commit.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test("returns an empty list for a Repository without commits", async () => {
    const repo = fixture();

    const list = await listCommits(await GitGateway.open(repo.root));

    expect(list.commits).toEqual([]);
    expect(list.worktree.branch).toBe("main");
  });

  test("formats relative dates with singular and plural units", () => {
    const now = new Date("2024-06-15T12:00:00.000Z");

    expect(relativeDate("2024-06-15T11:59:40.000Z", now)).toBe("just now");
    expect(relativeDate("2024-06-15T11:59:00.000Z", now)).toBe("1 minute ago");
    expect(relativeDate("2024-06-15T10:00:00.000Z", now)).toBe("2 hours ago");
    expect(relativeDate("2024-06-14T12:00:00.000Z", now)).toBe("1 day ago");
    expect(relativeDate("2024-06-01T12:00:00.000Z", now)).toBe("2 weeks ago");
  });
});
