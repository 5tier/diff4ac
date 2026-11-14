import { afterEach, describe, expect, test } from "bun:test";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeSet, CommitList } from "../src/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { createTempHome, type TempHome } from "./helpers/home";

const repos: FixtureRepo[] = [];
const homes: TempHome[] = [];
const servers: RunningServer[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function tempHome(): TempHome {
  const home = createTempHome();
  homes.push(home);
  return home;
}

async function start(repo: FixtureRepo): Promise<RunningServer> {
  const home = tempHome();
  const running = await startServer({
    repoPath: repo.root,
    homeDir: home.path,
  });
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
  return { status: response.status, body: body as T };
}

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

describe("HTTP Filters", () => {
  test("filters Pending changes and reports hidden files", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base");
    repo.write("src/app.ts", "app\n");
    repo.write("bun.lock", "lock\n");
    repo.write("dist/bundle.js", "bundle\n");
    repo.write("README.md", "readme\n");

    const running = await start(repo);

    const all = await getJson<ChangeSet>(running, "/api/pending");
    expect(all.status).toBe(200);
    expect(all.body.files.map((file) => file.path)).toEqual([
      "README.md",
      "src/app.ts",
    ]);
    expect(all.body.filter?.hiddenFiles).toBe(2);
    expect(all.body.filter?.availableExtensions).toEqual([
      ".js",
      ".lock",
      ".md",
      ".ts",
    ]);

    const noiseOff = await getJson<ChangeSet>(
      running,
      "/api/pending?noise=0",
    );
    expect(noiseOff.body.files.map((file) => file.path)).toEqual([
      "bun.lock",
      "dist/bundle.js",
      "README.md",
      "src/app.ts",
    ]);
    expect(noiseOff.body.filter?.hiddenFiles).toBe(0);

    const extension = await getJson<ChangeSet>(
      running,
      "/api/pending?ext=.ts",
    );
    expect(extension.body.files.map((file) => file.path)).toEqual([
      "README.md",
    ]);
    expect(extension.body.filter?.hiddenFiles).toBe(3);

    const included = await getJson<ChangeSet>(
      running,
      "/api/pending?include=src%2F%2A%2A",
    );
    expect(included.body.files.map((file) => file.path)).toEqual([
      "src/app.ts",
    ]);
    expect(included.body.filter?.hiddenFiles).toBe(3);

    const excluded = await getJson<ChangeSet>(
      running,
      "/api/pending?exclude=src%2F%2A%2A",
    );
    expect(excluded.body.files.map((file) => file.path)).toEqual([
      "README.md",
    ]);
    expect(excluded.body.filter?.hiddenFiles).toBe(3);

    const basenameExclude = await getJson<ChangeSet>(
      running,
      "/api/pending?exclude=*.ts",
    );
    expect(basenameExclude.body.files.map((file) => file.path)).toEqual([
      "README.md",
    ]);
    expect(basenameExclude.body.filter?.hiddenFiles).toBe(3);

    const basenameInclude = await getJson<ChangeSet>(
      running,
      "/api/pending?include=*.md",
    );
    expect(basenameInclude.body.files.map((file) => file.path)).toEqual([
      "README.md",
    ]);
    expect(basenameInclude.body.filter?.hiddenFiles).toBe(3);

    const combined = await getJson<ChangeSet>(
      running,
      "/api/pending?ext=.md&include=**&exclude=dist%2F%2A%2A",
    );
    expect(combined.body.files.map((file) => file.path)).toEqual([
      "src/app.ts",
    ]);
    expect(combined.body.filter?.hiddenFiles).toBe(3);

    const invalid = await getJson<ChangeSet>(
      running,
      "/api/pending?include=%00",
    );
    expect(invalid.status).toBe(400);
  });

  test("filters Commit Stack groups and Time Window Change Sets", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base", { date: "2024-01-01T12:01:00.000Z" });
    repo.write("src/stack.ts", "one\n");
    repo.write("stack.lock", "lock one\n");
    const first = repo.commit("stack one", {
      date: "2024-01-01T12:02:00.000Z",
    });
    repo.write("src/stack.ts", "two\n");
    repo.write("stack.lock", "lock two\n");
    const second = repo.commit("stack two", {
      date: "2024-01-01T12:03:00.000Z",
    });

    const running = await start(repo);

    const stack = await getJson<ChangeSet>(
      running,
      `/api/commit-set?hashes=${first},${second}&mode=stack`,
    );
    expect(stack.status).toBe(200);
    expect(stack.body.commitGroups).toHaveLength(2);
    expect(
      stack.body.commitGroups?.map((group) =>
        group.files.map((file) => file.path),
      ),
    ).toEqual([["src/stack.ts"], ["src/stack.ts"]]);
    expect(stack.body.filter?.hiddenFiles).toBe(1);

    const window = await getJson<ChangeSet>(
      running,
      "/api/time-window?start=2024-01-01T12%3A01%3A30.000Z&end=2024-01-01T12%3A03%3A30.000Z&preset=custom&mode=net",
    );
    expect(window.status).toBe(200);
    expect(window.body.selection.kind).toBe("time-window");
    expect(window.body.files.map((file) => file.path)).toEqual([
      "src/stack.ts",
    ]);
    expect(window.body.filter?.hiddenFiles).toBe(1);

    const commits = await getJson<CommitList>(running, "/api/commits");
    expect(commits.body.commits.map((commit) => commit.hash)).toContain(first);
  });

  test("uses Noise patterns from Repository config", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base");
    repo.write(".git/info/exclude", ".diff4ac.json\n");
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({ noise: ["**/*.lock"] })}\n`,
    );
    repo.write("src/app.ts", "app\n");
    repo.write("bun.lock", "lock\n");
    repo.write("dist/bundle.js", "bundle\n");

    const running = await start(repo);

    const result = await getJson<ChangeSet>(running, "/api/pending");
    expect(result.body.files.map((file) => file.path)).toEqual([
      "dist/bundle.js",
      "src/app.ts",
    ]);
    expect(result.body.filter?.hiddenFiles).toBe(1);
  });
});
