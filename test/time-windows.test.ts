import { afterEach, describe, expect, test } from "bun:test";
import { buildTimeWindowChangeSet } from "../src/changeset/commits";
import { GitGateway } from "../src/git/gateway";
import { listCommitsInWindow } from "../src/repository/commits";
import {
  createCustomTimeWindow,
  createPresetTimeWindow,
} from "../src/time-windows";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function localDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

describe("Time Window boundaries", () => {
  test("presets use local midnight boundaries", () => {
    const now = new Date(2024, 0, 15, 12, 0, 0);

    const today = createPresetTimeWindow("today", now);
    expect(new Date(today.start).getTime()).toBe(
      new Date(2024, 0, 15, 0, 0, 0).getTime(),
    );
    expect(new Date(today.end).getTime()).toBe(
      new Date(2024, 0, 16, 0, 0, 0).getTime(),
    );

    const yesterday = createPresetTimeWindow("yesterday", now);
    expect(new Date(yesterday.start).getTime()).toBe(
      new Date(2024, 0, 14, 0, 0, 0).getTime(),
    );
    expect(new Date(yesterday.end).getTime()).toBe(
      new Date(2024, 0, 15, 0, 0, 0).getTime(),
    );

    const last24h = createPresetTimeWindow("last-24h", now);
    expect(new Date(last24h.end).getTime()).toBe(now.getTime());
    expect(new Date(last24h.start).getTime()).toBe(
      now.getTime() - 24 * 60 * 60 * 1000,
    );

    const custom = createCustomTimeWindow("2024-01-01", "2024-01-02");
    expect(new Date(custom.start).getTime()).toBe(
      new Date(2024, 0, 1, 0, 0, 0).getTime(),
    );
    expect(new Date(custom.end).getTime()).toBe(
      new Date(2024, 0, 3, 0, 0, 0).getTime(),
    );
    expect(custom.label).toBe("2024-01-01 → 2024-01-02");
    expect(() => createCustomTimeWindow("2024-01-03", "2024-01-01")).toThrow();
  });

  test("commits either side of local midnight fall into the right day", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base", { date: localDate(2024, 1, 13, 12) });

    repo.write("before.txt", "before\n");
    const beforeMidnight = repo.commit("before midnight", {
      date: localDate(2024, 1, 14, 23, 59),
    });
    repo.write("after.txt", "after\n");
    const afterMidnight = repo.commit("after midnight", {
      date: localDate(2024, 1, 15, 0, 1),
    });

    const git = await GitGateway.open(repo.root);
    const now = new Date(2024, 0, 15, 12, 0, 0);

    const today = await listCommitsInWindow(
      git,
      createPresetTimeWindow("today", now),
    );
    expect(today.commits.map((commit) => commit.hash)).toContain(
      afterMidnight,
    );
    expect(today.commits.map((commit) => commit.hash)).not.toContain(
      beforeMidnight,
    );

    const yesterday = await listCommitsInWindow(
      git,
      createPresetTimeWindow("yesterday", now),
    );
    expect(yesterday.commits.map((commit) => commit.hash)).toContain(
      beforeMidnight,
    );
    expect(yesterday.commits.map((commit) => commit.hash)).not.toContain(
      afterMidnight,
    );
  });

  test("matching ignores the author date and uses the committer date", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base", { date: localDate(2024, 1, 10, 12) });

    repo.write("a.txt", "a\n");
    repo.commit("author old, committer new", {
      authorDate: localDate(2024, 1, 14, 12),
      committerDate: localDate(2024, 1, 15, 12),
    });

    repo.write("b.txt", "b\n");
    repo.commit("author new, committer old", {
      authorDate: localDate(2024, 1, 15, 12),
      committerDate: localDate(2024, 1, 14, 12),
    });

    const git = await GitGateway.open(repo.root);
    const today = await listCommitsInWindow(
      git,
      createPresetTimeWindow("today", new Date(2024, 0, 15, 18, 0, 0)),
    );
    const messages = today.commits.map((commit) => commit.message);

    expect(messages).toContain("author old, committer new");
    expect(messages).not.toContain("author new, committer old");
  });
});

describe("Time Window Change Sets", () => {
  test("builds a Net Diff for a contiguous window and handles an empty window", async () => {
    const repo = fixture();
    repo.write("file.txt", "one\n");
    repo.commit("base", { date: localDate(2024, 1, 1, 12) });
    repo.write("file.txt", "two\n");
    repo.commit("first in window", { date: localDate(2024, 1, 5, 12) });
    repo.write("file.txt", "three\n");
    repo.commit("second in window", { date: localDate(2024, 1, 6, 12) });
    repo.write("file.txt", "outside\n");
    repo.commit("outside window", { date: localDate(2024, 1, 20, 12) });

    const git = await GitGateway.open(repo.root);
    const window = createCustomTimeWindow("2024-01-04", "2024-01-06");
    const changeSet = await buildTimeWindowChangeSet(git, window);

    expect(changeSet.selection.kind).toBe("time-window");
    if (changeSet.selection.kind !== "time-window") {
      throw new Error("expected a time-window Selection");
    }
    expect(changeSet.selection.commits.map((commit) => commit.message)).toEqual([
      "second in window",
      "first in window",
    ]);
    expect(changeSet.selection.contiguous).toBe(true);
    expect(changeSet.selection.mode).toBe("net");
    expect(changeSet.commitGroups).toBeUndefined();
    expect(changeSet.files.map((file) => file.path)).toEqual(["file.txt"]);
    expect(changeSet.files[0]?.diff).toContain("-one");
    expect(changeSet.files[0]?.diff).toContain("+three");

    const emptyWindow = createCustomTimeWindow("2024-02-01", "2024-02-02");
    const empty = await buildTimeWindowChangeSet(git, emptyWindow);
    expect(empty.selection.kind).toBe("time-window");
    if (empty.selection.kind !== "time-window") {
      throw new Error("expected a time-window Selection");
    }
    expect(empty.selection.commits).toEqual([]);
    expect(empty.files).toEqual([]);
    expect(empty.totals).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  test("falls back to a Commit Stack for a non-contiguous window", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base", { date: localDate(2024, 1, 1, 12) });

    repo.git(["checkout", "-q", "-b", "sibling-a"]);
    repo.write("a.txt", "a\n");
    repo.commit("sibling a", { date: localDate(2024, 1, 10, 12) });

    repo.git(["checkout", "-q", "main"]);
    repo.git(["checkout", "-q", "-b", "sibling-b"]);
    repo.write("b.txt", "b\n");
    repo.commit("sibling b", { date: localDate(2024, 1, 11, 12) });

    repo.git(["checkout", "-q", "sibling-a"]);
    repo.git(["merge", "--no-ff", "-m", "merge siblings", "sibling-b"]);

    const git = await GitGateway.open(repo.root);
    const window = createCustomTimeWindow("2024-01-09", "2024-01-12");
    const changeSet = await buildTimeWindowChangeSet(git, window, "net");

    expect(changeSet.selection.kind).toBe("time-window");
    if (changeSet.selection.kind !== "time-window") {
      throw new Error("expected a time-window Selection");
    }
    expect(changeSet.selection.contiguous).toBe(false);
    expect(changeSet.selection.mode).toBe("stack");
    expect(changeSet.commitGroups?.map((group) => group.commit.message)).toEqual([
      "sibling a",
      "sibling b",
    ]);
  });
});
