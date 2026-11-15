import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPendingChangeSet } from "../src/changeset/pending";
import { applyFilters } from "../src/filters";
import { GitGateway } from "../src/git/gateway";
import { repositoryIdentity } from "../src/repository/identity";
import {
  annotateChangeSet,
  ReviewMarkStore,
} from "../src/review/marks";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeSet } from "../shared/types";
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

function tempHome(): TempHome {
  const home = createTempHome();
  homes.push(home);
  return home;
}

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "diff4ac-rename-state-"));
  directories.push(directory);
  return directory;
}

async function start(repo: FixtureRepo): Promise<RunningServer> {
  const home = tempHome();
  const running = await startServer({
    repoPath: repo.root,
    homeDir: home.path,
    stateDir: tempDirectory(),
  });
  servers.push(running);
  return running;
}

function buffer(...values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
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
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Pending renames", () => {
  test("pairs an unstaged move as a rename with no content changes", async () => {
    const repo = fixture();
    const content = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
    repo.write("src/old-name.ts", content);
    repo.commit("initial");
    repo.rename("src/old-name.ts", "src/new-name.ts");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files[0];
    if (!file) {
      throw new Error("expected a paired rename");
    }

    expect(changeSet.files).toHaveLength(1);
    expect(file).toMatchObject({
      path: "src/new-name.ts",
      oldPath: "src/old-name.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      binary: false,
      oldRev: "index",
      newRev: "worktree",
    });
    expect(file.diff).toContain("rename from src/old-name.ts");
    expect(file.diff).toContain("rename to src/new-name.ts");
    expect(file.diff).toContain("similarity index 100%");
    expect(file.hunks).toEqual([]);
  });

  test("shows only real changes for a move with edits", async () => {
    const repo = fixture();
    repo.write(
      "src/old-name.ts",
      "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    );
    repo.commit("initial");
    repo.rename("src/old-name.ts", "src/new-name.ts");
    repo.write(
      "src/new-name.ts",
      "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\n",
    );

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files[0];
    if (!file) {
      throw new Error("expected a paired rename");
    }

    expect(file).toMatchObject({
      path: "src/new-name.ts",
      oldPath: "src/old-name.ts",
      status: "renamed",
      additions: 2,
      deletions: 1,
    });
    expect(file.diff).toContain("-beta");
    expect(file.diff).toContain("+BETA");
    expect(file.diff).toContain("+zeta");
    expect(file.diff).not.toContain("+alpha");
    expect(file.diff).toContain("diff --git a/src/old-name.ts b/src/new-name.ts");
    expect(file.diff).toContain("--- a/src/old-name.ts");
    expect(file.diff).toContain("+++ b/src/new-name.ts");
    expect(file.diff).not.toContain("diff4ac-rename-");
  });

  test("leaves dissimilar files as a deletion plus an untracked file", async () => {
    const repo = fixture();
    repo.write("docs/old.txt", "alpha\nbeta\ngamma\n");
    repo.commit("initial");
    repo.remove("docs/old.txt");
    repo.write("docs/new.txt", "one\ntwo\nthree\n");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const files = new Map(changeSet.files.map((file) => [file.path, file]));

    expect(changeSet.files).toHaveLength(2);
    expect(files.get("docs/old.txt")).toMatchObject({
      status: "deleted",
      additions: 0,
      deletions: 3,
    });
    expect(files.get("docs/new.txt")).toMatchObject({
      status: "untracked",
      additions: 3,
      deletions: 0,
    });
  });

  test("does not change git status or the index", async () => {
    const repo = fixture();
    repo.write("src/moved.ts", "one\ntwo\nthree\nfour\n");
    repo.commit("initial");
    repo.rename("src/moved.ts", "src/renamed.ts");
    repo.write(
      "src/renamed.ts",
      "one\nTWO\nthree\nfour\nfive\n",
    );

    const statusBefore = repo.git([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const indexBefore = repo.git(["ls-files", "--stage", "-z"]);

    await buildPendingChangeSet(await GitGateway.open(repo.root));

    expect(
      repo.git([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
    ).toBe(statusBefore);
    expect(repo.git(["ls-files", "--stage", "-z"])).toBe(indexBefore);
  });

  test("keeps Filters and Review Marks working on the new path", async () => {
    const repo = fixture();
    repo.write("src/old.ts", "alpha\nbeta\ngamma\ndelta\n");
    repo.commit("initial");
    repo.rename("src/old.ts", "src/new.ts");

    const git = await GitGateway.open(repo.root);
    const changeSet = await buildPendingChangeSet(git);
    const file = changeSet.files[0];
    if (!file) {
      throw new Error("expected a paired rename");
    }

    const filtered = applyFilters(changeSet, {
      disabledExtensions: [],
      includeGlobs: ["src/new.ts"],
      excludeGlobs: [],
      hideNoise: false,
      noisePatterns: [],
    });
    expect(filtered.files.map((candidate) => candidate.path)).toEqual([
      "src/new.ts",
    ]);

    const repositoryId = await repositoryIdentity(git);
    const store = new ReviewMarkStore(tempDirectory());
    store.setMarked(repositoryId, file.path, file.contentHash, true);
    expect(
      annotateChangeSet(changeSet, store, repositoryId).files[0]?.reviewed,
    ).toBe(true);

    repo.write("src/new.ts", "alpha\nBETA\ngamma\ndelta\n");
    const edited = await buildPendingChangeSet(git);
    const editedFile = edited.files[0];
    if (!editedFile) {
      throw new Error("expected an edited rename");
    }

    expect(editedFile.contentHash).not.toBe(file.contentHash);
    expect(
      annotateChangeSet(edited, store, repositoryId).files[0]?.reviewed,
    ).toBe(false);
  });

  test("reports a paired binary move with old and new sizes", async () => {
    const repo = fixture();
    repo.write("assets/icon.bin", buffer(0, 1, 2, 3));
    repo.commit("initial");
    repo.rename("assets/icon.bin", "assets/icon-moved.bin");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files[0];
    if (!file) {
      throw new Error("expected a paired binary rename");
    }

    expect(file).toMatchObject({
      path: "assets/icon-moved.bin",
      oldPath: "assets/icon.bin",
      status: "renamed",
      binary: true,
      image: false,
      additions: 0,
      deletions: 0,
      oldSize: 4,
      newSize: 4,
    });
    expect(file.diff).not.toContain("\0");
  });

  test("serves before and after images for a paired image move", async () => {
    const repo = fixture();
    const oldImage = buffer(0, 1, 1, 1, 0);
    const newImage = buffer(0, 1, 2, 1, 0);
    repo.write("assets/logo.png", oldImage);
    repo.commit("initial");
    repo.rename("assets/logo.png", "assets/brand.png");
    repo.write("assets/brand.png", newImage);

    const running = await start(repo);
    const pending = await getJson<ChangeSet>(running, "/api/pending");
    const file = pending.body.files[0];
    if (!file) {
      throw new Error("expected a paired image rename");
    }

    expect(file).toMatchObject({
      path: "assets/brand.png",
      oldPath: "assets/logo.png",
      status: "renamed",
      binary: true,
      image: true,
      oldRev: "index",
      newRev: "worktree",
      oldSize: oldImage.byteLength,
      newSize: newImage.byteLength,
    });

    const before = await getRaw(
      running,
      "/api/file-content?selection=pending&path=assets%2Fbrand.png&rev=index",
    );
    expect(before.status).toBe(200);
    expect(before.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(before.bytes)]).toEqual([...oldImage]);

    const after = await getRaw(
      running,
      "/api/file-content?selection=pending&path=assets%2Fbrand.png&rev=worktree",
    );
    expect(after.status).toBe(200);
    expect([...new Uint8Array(after.bytes)]).toEqual([...newImage]);
  });
});

interface JsonResponse<T> {
  readonly status: number;
  readonly body: T;
}

async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<JsonResponse<T>> {
  const response = await getRaw(running, path);
  const text = Buffer.from(response.bytes).toString("utf8");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T };
}

async function getRaw(
  running: RunningServer,
  path: string,
): Promise<{
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: ArrayBuffer;
}> {
  const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    headers: { "x-diff4ac-token": running.token },
  });
  return {
    status: response.status,
    headers: response.headers,
    bytes: await response.arrayBuffer(),
  };
}
