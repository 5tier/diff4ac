import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildScopedChangeFile,
  buildScopedChangeSet,
  type ChangeSetScope,
} from "../src/changeset/scope";
import { GitGateway, setGitSpawnObserver } from "../src/git/gateway";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeFile, ChangeSet, TimeWindow } from "../src/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { createTempHome, type TempHome } from "./helpers/home";

const repos: FixtureRepo[] = [];
const homes: TempHome[] = [];
const servers: RunningServer[] = [];
const directories: string[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function buffer(...values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

afterEach(() => {
  setGitSpawnObserver(null);
  for (const server of servers.splice(0)) {
    server.stop();
  }
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
  for (const home of homes.splice(0)) {
    home.dispose();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface EquivalenceFixture {
  readonly repo: FixtureRepo;
  readonly first: string;
  readonly second: string;
}

function equivalenceFixture(): EquivalenceFixture {
  const repo = fixture();

  repo.write("src/base.ts", "base one\nbase two\n");
  repo.write("src/staged.ts", "staged one\n");
  repo.write("src/unstaged.ts", "unstaged one\n");
  repo.write("src/rename-old.ts", "alpha\nbeta\ngamma\ndelta\nepsilon\n");
  repo.write("src/colon:name.txt", "colon one\n");
  repo.write("assets/icon.bin", buffer(0, 1, 2, 3));
  repo.write("assets/logo.png", buffer(0, 1, 2, 3, 4));
  const first = repo.commit("first commit");

  repo.write("src/base.ts", "base one\nbase two changed\n");
  repo.write("src/colon:name.txt", "colon two\n");
  repo.write("src/staged.ts", "staged two\n");
  repo.write("src/unstaged.ts", "unstaged two\n");
  repo.git(["branch", "feature"]);
  const second = repo.commit("second commit");

  repo.git(["checkout", "-q", "feature"]);
  repo.write("src/feature.ts", "feature work\n");
  repo.commit("feature commit");
  repo.git(["checkout", "-q", "main"]);

  repo.write("src/staged.ts", "staged three\n");
  repo.stage("src/staged.ts");
  repo.write("src/unstaged.ts", "unstaged three\n");
  repo.write("src/untracked.ts", "untracked content\n");
  repo.rename("src/rename-old.ts", "src/rename-new.ts");
  repo.write(
    "src/rename-new.ts",
    "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\n",
  );
  repo.write("assets/icon.bin", buffer(0, 9, 9, 9));
  repo.write("assets/logo.png", buffer(0, 9, 8, 7, 6));

  return { repo, first, second };
}

async function expectParity(
  git: GitGateway,
  scope: ChangeSetScope,
  files: readonly ChangeFile[],
): Promise<void> {
  for (const file of files) {
    const rev = file.newRev ?? file.oldRev ?? null;
    const single = await buildScopedChangeFile(git, scope, file.path, rev);
    expect(single, `${scope.kind}:${file.path}:${rev ?? ""}`).toEqual(file);
  }
}

describe("file-oriented Change Sets", () => {
  test("single-file builds equal the whole Change Set for every scope kind", async () => {
    const { repo, first, second } = equivalenceFixture();
    const git = await GitGateway.open(repo.root);

    const pending = await buildScopedChangeSet(git, { kind: "pending" });
    const pendingStatuses = new Set(pending.files.map((file) => file.status));
    expect(pendingStatuses.has("modified")).toBe(true);
    expect(pendingStatuses.has("renamed")).toBe(true);
    expect(pendingStatuses.has("untracked")).toBe(true);
    expect(
      pending.files.find((file) => file.path === "assets/icon.bin")?.binary,
    ).toBe(true);
    expect(
      pending.files.find((file) => file.path === "assets/logo.png")?.image,
    ).toBe(true);
    await expectParity(git, { kind: "pending" }, pending.files);

    const commitScope: ChangeSetScope = { kind: "commit", hash: second };
    const commit = await buildScopedChangeSet(git, commitScope);
    expect(commit.files.length).toBeGreaterThan(0);
    await expectParity(git, commitScope, commit.files);

    const netScope: ChangeSetScope = {
      kind: "commits",
      hashes: [second, first],
      mode: "net",
    };
    const net = await buildScopedChangeSet(git, netScope);
    await expectParity(git, netScope, net.files);

    const stackScope: ChangeSetScope = {
      kind: "commits",
      hashes: [second, first],
      mode: "stack",
    };
    const stack = await buildScopedChangeSet(git, stackScope);
    expect(stack.commitGroups?.length).toBe(2);
    for (const group of stack.commitGroups ?? []) {
      await expectParity(git, stackScope, group.files);
    }

    const windowScope: ChangeSetScope = {
      kind: "time-window",
      window: {
        preset: "custom",
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-03T00:00:00.000Z",
        label: "test window",
      },
      mode: "auto",
    };
    const window = await buildScopedChangeSet(git, windowScope);
    expect(window.files.length).toBeGreaterThan(0);
    for (const group of window.commitGroups ?? []) {
      await expectParity(git, windowScope, group.files);
    }
    if (!window.commitGroups) {
      await expectParity(git, windowScope, window.files);
    }

    const branchScope: ChangeSetScope = { kind: "branch", name: "feature" };
    const branch = await buildScopedChangeSet(git, branchScope, {
      baseBranch: "main",
    });
    expect(branch.files.length).toBeGreaterThan(0);
    for (const file of branch.files) {
      const rev = file.newRev ?? file.oldRev ?? null;
      const single = await buildScopedChangeFile(
        git,
        branchScope,
        file.path,
        rev,
        { baseBranch: "main" },
      );
      expect(single).toEqual(file);
    }
  });

  test("returns undefined for a path or rev outside the Selection", async () => {
    const { repo, second } = equivalenceFixture();
    const git = await GitGateway.open(repo.root);

    expect(
      await buildScopedChangeFile(git, { kind: "pending" }, "missing.ts"),
    ).toBeUndefined();
    expect(
      await buildScopedChangeFile(
        git,
        { kind: "commit", hash: second },
        "src/base.ts",
        "deadbeef",
      ),
    ).toBeUndefined();
  });

  test("the full Change Set output matches the batching snapshot", async () => {
    const { repo, first, second } = equivalenceFixture();
    const git = await GitGateway.open(repo.root);

    const pending = await buildScopedChangeSet(git, { kind: "pending" });
    expect(pending.files).toMatchSnapshot("pending files");

    const commit = await buildScopedChangeSet(git, {
      kind: "commit",
      hash: second,
    });
    expect(commit.files).toMatchSnapshot("commit files");

    const net = await buildScopedChangeSet(git, {
      kind: "commits",
      hashes: [second, first],
      mode: "net",
    });
    expect(net.files).toMatchSnapshot("net files");

    const stack = await buildScopedChangeSet(git, {
      kind: "commits",
      hashes: [second, first],
      mode: "stack",
    });
    expect(
      (stack.commitGroups ?? []).map((group) => group.files),
    ).toMatchSnapshot("stack group files");

    const window = await buildScopedChangeSet(git, {
      kind: "time-window",
      window: {
        preset: "custom",
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-03T00:00:00.000Z",
        label: "test window",
      },
      mode: "auto",
    });
    expect(window.files).toMatchSnapshot("time-window files");

    const branch = await buildScopedChangeSet(
      git,
      { kind: "branch", name: "feature" },
      { baseBranch: "main" },
    );
    expect(branch.files).toMatchSnapshot("branch files");
  });
});

const WINDOW: TimeWindow = {
  preset: "custom",
  start: "2024-01-01T00:00:00.000Z",
  end: "2024-01-03T00:00:00.000Z",
  label: "test window",
};

async function start(repo: FixtureRepo): Promise<RunningServer> {
  const home = createTempHome();
  homes.push(home);
  const running = await startServer({
    repoPath: repo.root,
    homeDir: home.path,
    stateDir: tempDirectory("diff4ac-file-oriented-state-"),
  });
  servers.push(running);
  return running;
}

async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<{ readonly status: number; readonly body: T }> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `http://127.0.0.1:${running.port}${path}${separator}token=${encodeURIComponent(
      running.token,
    )}`,
  );
  const text = await response.text();
  return {
    status: response.status,
    body: (response.ok ? JSON.parse(text) : text) as T,
  };
}

function largeCommitRepo(): { repo: FixtureRepo; hash: string } {
  const repo = fixture();
  const count = 200;
  for (let index = 0; index < count; index++) {
    repo.write(`files/file-${index}.txt`, `base ${index}\n`);
  }
  repo.commit("base");
  for (let index = 0; index < count; index++) {
    repo.write(`files/file-${index}.txt`, `changed ${index}\n`);
  }
  const hash = repo.commit("change all");

  return { repo, hash };
}

describe("single-file endpoints", () => {
  test("still apply Filters and return 404 for hidden files", async () => {
    const { repo, second } = equivalenceFixture();
    const running = await start(repo);
    const base = `/api/file-diff?selection=commit&hash=${second}&path=src%2Fbase.ts&rev=${second}`;

    const visible = await getJson<ChangeFile>(running, base);
    expect(visible.status).toBe(200);
    expect(visible.body.path).toBe("src/base.ts");

    const hidden = await getJson<ChangeFile>(
      running,
      `${base}&exclude=src%2Fbase.ts`,
    );
    expect(hidden.status).toBe(404);
  });
});

describe("git process counts", () => {
  test("/api/file-diff spawns a constant number of git processes", async () => {
    const { repo, hash } = largeCommitRepo();
    const running = await start(repo);

    let spawned = 0;
    setGitSpawnObserver(() => {
      spawned++;
    });
    const response = await getJson<ChangeFile>(
      running,
      `/api/file-diff?selection=commit&hash=${hash}&path=files%2Ffile-0.txt&rev=${hash}`,
    );
    setGitSpawnObserver(null);

    expect(response.status).toBe(200);
    expect(response.body.path).toBe("files/file-0.txt");
    expect(spawned).toBeLessThanOrEqual(6);
  });

  test("building a Change Set spawns one diff per file plus a constant", async () => {
    const { repo, hash } = largeCommitRepo();
    const running = await start(repo);

    let spawned = 0;
    setGitSpawnObserver(() => {
      spawned++;
    });
    const response = await getJson<ChangeSet>(
      running,
      `/api/commit?hash=${hash}`,
    );
    setGitSpawnObserver(null);

    expect(response.status).toBe(200);
    expect(response.body.files).toHaveLength(200);
    expect(spawned).toBeGreaterThanOrEqual(200);
    expect(spawned).toBeLessThanOrEqual(200 + 12);
  });

  test("time-window and commit-set endpoints share the batched builder", async () => {
    const { repo, hash } = largeCommitRepo();
    const running = await start(repo);

    let spawned = 0;
    setGitSpawnObserver(() => {
      spawned++;
    });
    const response = await getJson<ChangeSet>(
      running,
      `/api/time-window?start=${encodeURIComponent(WINDOW.start)}` +
        `&end=${encodeURIComponent(WINDOW.end)}` +
        `&preset=${WINDOW.preset}&mode=net`,
    );
    setGitSpawnObserver(null);

    expect(response.status).toBe(200);
    expect(response.body.files.length).toBeGreaterThan(190);
    expect(spawned).toBeLessThanOrEqual(response.body.files.length + 20);
  });
});
