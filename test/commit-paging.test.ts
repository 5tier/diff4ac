import { afterEach, describe, expect, test } from "bun:test";
import { cleanupFixtureServers } from "./helpers/server";
import { isContiguousCommitSelection } from "../shared/changeset/selection";
import {
  createCustomTimeWindow,
  filterCommitsInTimeWindow,
} from "../shared/time-windows";
import type {
  ChangeViewMode,
  CommitList,
  CommitSummary,
} from "../shared/types";
import {
  NonContiguousNetDiffError,
  resolveSelectedCommits,
} from "../src/changeset/commits";
import { GitGateway, setGitSpawnObserver } from "../src/git/gateway";
import {
  listCommits,
  listCommitsInWindow,
  setSinceAsFilterSupport,
} from "../src/repository/commits";
import {
  createFixtureRepo,
  type FixtureRepo,
} from "./helpers/fixture";
import {
  getJson,
  startFixtureServer,
} from "./helpers/server";

const CLAUDE = {
  name: "Claude Code",
  email: "noreply@anthropic.com",
};

const repos: FixtureRepo[] = [];

afterEach(() => {
  cleanupFixtureServers();
  setGitSpawnObserver(null);
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function localDate(
  year: number,
  month: number,
  day: number,
  hour = 12,
): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

function linearRepo(count = 5): {
  readonly repo: FixtureRepo;
  readonly hashes: readonly string[];
} {
  const repo = fixture();
  const hashes: string[] = [];
  for (let index = 0; index < count; index++) {
    repo.write(`src/file-${index}.ts`, `content ${index}\n`);
    hashes.push(repo.commit(`commit ${index + 1}`));
  }
  return { repo, hashes };
}

describe("Commits list paging", () => {
  test("returns pages with hasMore and stable newest-first order", async () => {
    const { repo, hashes } = linearRepo(5);
    const git = await GitGateway.open(repo.root);

    const first = await listCommits(git, { limit: 2 });
    expect(first.commits.map((commit) => commit.hash)).toEqual([
      hashes[4]!,
      hashes[3]!,
    ]);
    expect(first.hasMore).toBe(true);

    const second = await listCommits(git, { limit: 2, skip: 2 });
    expect(second.commits.map((commit) => commit.hash)).toEqual([
      hashes[2]!,
      hashes[1]!,
    ]);
    expect(second.hasMore).toBe(true);

    const last = await listCommits(git, { limit: 2, skip: 4 });
    expect(last.commits.map((commit) => commit.hash)).toEqual([hashes[0]!]);
    expect(last.hasMore).toBe(false);

    const past = await listCommits(git, { limit: 2, skip: 5 });
    expect(past.commits).toEqual([]);
    expect(past.hasMore).toBe(false);
  });

  test("agent filtering applies per page and hasMore stays unfiltered", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("human one");
    repo.write("b.txt", "b\n");
    repo.commit("claude one", { author: CLAUDE });
    repo.write("c.txt", "c\n");
    repo.commit("human two");
    repo.write("d.txt", "d\n");
    repo.commit("claude two", { author: CLAUDE });
    repo.write("e.txt", "e\n");
    repo.commit("claude three", { author: CLAUDE });

    const git = await GitGateway.open(repo.root);
    const page = await listCommits(git, {
      limit: 2,
      agent: "Claude Code",
    });

    expect(page.hasMore).toBe(true);
    expect(page.commits.map((commit) => commit.message)).toEqual([
      "claude three",
      "claude two",
    ]);
    expect(page.commits.every((commit) => commit.agent === "Claude Code")).toBe(
      true,
    );

    const sparse = await listCommits(git, {
      limit: 1,
      skip: 2,
      agent: "Claude Code",
    });
    expect(sparse.hasMore).toBe(true);
    expect(sparse.commits.every((commit) => commit.agent === "Claude Code")).toBe(
      true,
    );
  });

  test("/api/commits pages, validates skip and keeps the agent filter", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("human one");
    repo.write("b.txt", "b\n");
    repo.commit("claude one", { author: CLAUDE });
    repo.write("c.txt", "c\n");
    repo.commit("human two");
    repo.write("d.txt", "d\n");
    repo.commit("claude two", { author: CLAUDE });
    repo.write("e.txt", "e\n");
    repo.commit("claude three", { author: CLAUDE });

    const running = (
      await startFixtureServer({ repo, commitPageSize: 2 })
    ).running;

    const first = await getJson<CommitList>(running, "/api/commits");
    expect(first.status).toBe(200);
    expect(first.body.commits.map((commit) => commit.message)).toEqual([
      "claude three",
      "claude two",
    ]);
    expect(first.body.hasMore).toBe(true);

    const next = await getJson<CommitList>(
      running,
      "/api/commits?skip=2",
    );
    expect(next.body.commits.map((commit) => commit.message)).toEqual([
      "human two",
      "claude one",
    ]);
    expect(next.body.hasMore).toBe(true);

    const filtered = await getJson<CommitList>(
      running,
      "/api/commits?agent=Claude%20Code",
    );
    expect(filtered.body.hasMore).toBe(true);
    expect(
      filtered.body.commits.every((commit) => commit.agent === "Claude Code"),
    ).toBe(true);

    for (const skip of ["bad", "-1", "1.5", "", "99999999999999999999"]) {
      const rejected = await getJson<string>(
        running,
        `/api/commits?skip=${encodeURIComponent(skip)}`,
      );
      expect(rejected.status).toBe(400);
      expect(rejected.body).toBe(
        "Bad request: skip must be a non-negative integer",
      );
    }
  });

  test("/api/commits bounds git log; Time Windows bound theirs by date", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("one", { date: localDate(2024, 1, 1) });
    repo.write("b.txt", "b\n");
    repo.commit("two", { date: localDate(2024, 1, 2) });

    const running = (
      await startFixtureServer({ repo, commitPageSize: 2 })
    ).running;

    const calls: string[][] = [];
    setGitSpawnObserver((args) => calls.push([...args]));

    await getJson<CommitList>(running, "/api/commits");
    expect(
      calls.some((args) => args.includes("-n") || args.includes("--max-count")),
    ).toBe(true);

    calls.length = 0;
    const window = new URLSearchParams({
      start: localDate(2024, 1, 1, 0),
      end: localDate(2024, 1, 3, 0),
      preset: "custom",
      mode: "net",
    });
    await getJson<ChangeSetLike>(
      running,
      `/api/time-window?${window.toString()}`,
    );
    expect(calls.some((args) => args.some((arg) => arg.startsWith("--since")))).toBe(
      true,
    );
    expect(calls.some((args) => args.some((arg) => arg.startsWith("--until")))).toBe(
      true,
    );
  });
});

interface ChangeSetLike {
  readonly files: readonly unknown[];
}

describe("Time Window equivalence", () => {
  test("bounded git log plus the exact filter matches full-history filtering", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base", { date: localDate(2024, 1, 1) });
    repo.write("a.txt", "a\n");
    repo.commit("newer parent", { date: localDate(2024, 1, 10) });
    // A child with an older committer date: a rebase-like out-of-order history.
    repo.write("b.txt", "b\n");
    repo.commit("older child", { date: localDate(2024, 1, 5) });

    const git = await GitGateway.open(repo.root);
    const full = await listCommits(git, { limit: 10_000 });

    const windows = [
      createCustomTimeWindow("2024-01-01", "2024-01-02"),
      createCustomTimeWindow("2024-01-04", "2024-01-06"),
      createCustomTimeWindow("2024-01-09", "2024-01-11"),
      createCustomTimeWindow("2024-01-01", "2024-01-12"),
      createCustomTimeWindow("2024-02-01", "2024-02-02"),
    ];

    for (const window of windows) {
      const expected = filterCommitsInTimeWindow(full.commits, window).map(
        (commit) => commit.hash,
      );
      const actual = await listCommitsInWindow(git, window);
      expect(actual.commits.map((commit) => commit.hash)).toEqual(expected);
      expect(actual.hasMore).toBe(false);
    }
  });
});

interface ReferenceSelection {
  readonly hashes: readonly string[];
  readonly mode: ChangeViewMode;
  readonly contiguous: boolean;
}

async function referenceSelection(
  git: GitGateway,
  hashes: readonly string[],
  mode: ChangeViewMode,
): Promise<ReferenceSelection> {
  const list = await listCommits(git, { limit: 10_000 });
  const positions = new Map(
    list.commits.map((commit, index) => [commit.hash, index] as const),
  );
  const byHash = new Map(
    list.commits.map((commit) => [commit.hash, commit] as const),
  );

  const selected: CommitSummary[] = [];
  const seen = new Set<string>();
  for (const hash of hashes) {
    const commit = byHash.get(hash);
    if (!commit) {
      throw new Error(`missing ${hash}`);
    }
    if (!seen.has(hash)) {
      seen.add(hash);
      selected.push(commit);
    }
  }
  selected.sort(
    (left, right) =>
      (positions.get(left.hash) ?? 0) - (positions.get(right.hash) ?? 0),
  );

  return {
    hashes: selected.map((commit) => commit.hash),
    mode,
    contiguous: isContiguousCommitSelection(selected),
  };
}

describe("Time Window git compatibility", () => {
  test("falls back to the unbounded log when --since-as-filter is unsupported", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base", { date: localDate(2024, 1, 1) });

    repo.git(["checkout", "-q", "-b", "sibling-a"]);
    repo.write("a.txt", "a\n");
    repo.commit("sibling a", { date: localDate(2024, 1, 10) });

    repo.git(["checkout", "-q", "main"]);
    repo.git(["checkout", "-q", "-b", "sibling-b"]);
    repo.write("b.txt", "b\n");
    repo.commit("sibling b", { date: localDate(2024, 1, 11) });

    repo.git(["checkout", "-q", "sibling-a"]);
    repo.git(["merge", "--no-ff", "-m", "merge siblings", "sibling-b"]);

    const git = await GitGateway.open(repo.root);
    const window = createCustomTimeWindow("2024-01-09", "2024-01-12");
    const full = await listCommits(git, { limit: 10_000 });
    const expected = filterCommitsInTimeWindow(full.commits, window).map(
      (commit) => commit.hash,
    );

    const calls: string[][] = [];
    setSinceAsFilterSupport(false);
    setGitSpawnObserver((args) => calls.push([...args]));
    try {
      const fallback = await listCommitsInWindow(git, window);
      expect(fallback.commits.map((commit) => commit.hash)).toEqual(expected);

      const logCalls = calls.filter((args) => args[0] === "log");
      expect(logCalls.length).toBeGreaterThan(0);
      expect(
        logCalls.some((args) =>
          args.some((arg) => arg.startsWith("--since") || arg.startsWith("--until")),
        ),
      ).toBe(false);
    } finally {
      setSinceAsFilterSupport(null);
      setGitSpawnObserver(null);
    }
  });
});

describe("resolveSelectedCommits equivalence", () => {
  test("matches the full-list ordering for contiguous, gapped and out-of-order picks", async () => {
    const { repo, hashes } = linearRepo(5);
    const git = await GitGateway.open(repo.root);

    const cases: readonly {
      readonly picks: readonly string[];
      readonly mode: ChangeViewMode;
    }[] = [
      { picks: [hashes[2]!, hashes[3]!], mode: "net" },
      { picks: [hashes[3]!, hashes[2]!], mode: "net" },
      { picks: [hashes[4]!, hashes[1]!, hashes[2]!, hashes[3]!], mode: "net" },
      { picks: [hashes[0]!, hashes[2]!], mode: "stack" },
      { picks: [hashes[4]!, hashes[2]!, hashes[0]!], mode: "stack" },
    ];

    for (const { picks, mode } of cases) {
      const expected = await referenceSelection(git, picks, mode);
      const resolved = await resolveSelectedCommits(git, picks, mode);

      expect(resolved.selection.kind).toBe("commits");
      if (resolved.selection.kind !== "commits") {
        continue;
      }
      expect(resolved.selection.commits.map((commit) => commit.hash)).toEqual([
        ...expected.hashes,
      ]);
      expect(resolved.selection.mode).toBe(expected.mode);
      expect(resolved.selection.contiguous).toBe(expected.contiguous);
      expect(resolved.selected.map((commit) => commit.hash)).toEqual([
        ...expected.hashes,
      ]);
    }
  });

  test("keeps the non-contiguous Net Diff error and unknown commit behaviour", async () => {
    const { repo, hashes } = linearRepo(4);
    const git = await GitGateway.open(repo.root);

    await expect(
      resolveSelectedCommits(git, [hashes[0]!, hashes[2]!], "net"),
    ).rejects.toBeInstanceOf(NonContiguousNetDiffError);

    await expect(
      resolveSelectedCommits(git, ["deadbeef"], "net"),
    ).rejects.toMatchObject({ name: "UnknownCommitError" });
  });
});
