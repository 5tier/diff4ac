import { afterEach, describe, expect, test } from "bun:test";
import { createTempDirectory } from "./helpers/cleanup";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildPendingChangeSet } from "../src/changeset/pending";
import { GitGateway } from "../src/git/gateway";
import { repositoryIdentity } from "../src/repository/identity";
import {
  annotateChangeSet,
  ReviewMarkStore,
} from "../src/review/marks";
import type { RunningServer } from "../src/server/server";
import type { ChangeSet } from "../shared/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { startFixtureServer } from "./helpers/server";

const repos: FixtureRepo[] = [];
const stateDirs: string[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function stateDir(): string {
  const directory = createTempDirectory("diff4ac-state-");
  stateDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
  for (const directory of stateDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Review Mark Store", () => {
  test("persists an unchanged file across sessions and lapses when its content changes", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    repo.write("src/app.ts", "two\n");

    const git = await GitGateway.open(repo.root);
    const repositoryId = await repositoryIdentity(git);
    const first = await buildPendingChangeSet(git);
    const firstFile = first.files[0];
    if (!firstFile) {
      throw new Error("expected a changed file");
    }

    const directory = stateDir();
    const store = new ReviewMarkStore(directory);
    expect(store.isMarked(repositoryId, firstFile.path, firstFile.contentHash)).toBe(false);

    store.setMarked(repositoryId, firstFile.path, firstFile.contentHash, true);

    const nextSession = new ReviewMarkStore(directory);
    expect(
      nextSession.isMarked(repositoryId, firstFile.path, firstFile.contentHash),
    ).toBe(true);

    const marked = annotateChangeSet(first, nextSession, repositoryId);
    expect(marked.files[0]?.reviewed).toBe(true);
    expect(existsSync(join(repo.root, ".diff4ac"))).toBe(false);
    expect(existsSync(join(directory, "review-marks.json"))).toBe(true);

    repo.write("src/app.ts", "three\n");
    const second = await buildPendingChangeSet(git);
    const secondFile = second.files[0];
    if (!secondFile) {
      throw new Error("expected a changed file");
    }

    expect(secondFile.contentHash).not.toBe(firstFile.contentHash);
    expect(
      nextSession.isMarked(repositoryId, secondFile.path, secondFile.contentHash),
    ).toBe(false);
    expect(
      annotateChangeSet(second, nextSession, repositoryId).files[0]?.reviewed,
    ).toBe(false);
  });

  test("marks a deletion and keys it on the deleted content", async () => {
    const repo = fixture();
    repo.write("gone.txt", "old\n");
    repo.commit("initial");
    repo.remove("gone.txt");

    const git = await GitGateway.open(repo.root);
    const repositoryId = await repositoryIdentity(git);
    const first = await buildPendingChangeSet(git);
    const deleted = first.files[0];
    if (!deleted) {
      throw new Error("expected a deleted file");
    }

    expect(deleted.status).toBe("deleted");
    expect(deleted.contentHash.startsWith("deleted:")).toBe(true);

    const directory = stateDir();
    const store = new ReviewMarkStore(directory);
    store.setMarked(repositoryId, deleted.path, deleted.contentHash, true);

    const nextSession = new ReviewMarkStore(directory);
    expect(
      annotateChangeSet(first, nextSession, repositoryId).files[0]?.reviewed,
    ).toBe(true);

    repo.write("gone.txt", "different\n");
    repo.commit("restore with different content");
    repo.remove("gone.txt");
    const second = await buildPendingChangeSet(git);
    const secondDeletion = second.files[0];
    if (!secondDeletion) {
      throw new Error("expected a deleted file");
    }

    expect(secondDeletion.contentHash).not.toBe(deleted.contentHash);
    expect(
      nextSession.isMarked(
        repositoryId,
        secondDeletion.path,
        secondDeletion.contentHash,
      ),
    ).toBe(false);
  });
});

async function request(
  running: RunningServer,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${running.port}${path}`, {
    ...init,
    headers: {
      "x-diff4ac-token": running.token,
      ...(init.headers ?? {}),
    },
  });
}

async function pendingFile(
  running: RunningServer,
): Promise<{ path: string; contentHash: string; reviewed?: boolean }> {
  const response = await request(running, "/api/pending");
  expect(response.status).toBe(200);
  const changeSet = (await response.json()) as ChangeSet;
  const file = changeSet.files[0];
  if (!file) {
    throw new Error("expected a pending file");
  }
  return {
    path: file.path,
    contentHash: file.contentHash,
    reviewed: file.reviewed,
  };
}

describe("Review Marks HTTP API", () => {
  test("marks files outside the Repository and keeps them across sessions", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    repo.write("src/app.ts", "two\n");

    const directory = stateDir();
    const firstSession = (
      await startFixtureServer({ repo, stateDir: directory })
    ).running;

    const file = await pendingFile(firstSession);
    expect(file.reviewed).toBe(false);

    const marked = await request(firstSession, "/api/review-mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: file.path,
        contentHash: file.contentHash,
        reviewed: true,
      }),
    });
    expect(marked.status).toBe(200);
    expect(await pendingFile(firstSession)).toMatchObject({ reviewed: true });
    expect(existsSync(join(repo.root, ".diff4ac"))).toBe(false);
    expect(existsSync(join(directory, "review-marks.json"))).toBe(true);

    firstSession.stop();

    const secondSession = (
      await startFixtureServer({ repo, stateDir: directory })
    ).running;
    expect(await pendingFile(secondSession)).toMatchObject({ reviewed: true });

    const unmarked = await request(secondSession, "/api/review-mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: file.path,
        contentHash: file.contentHash,
        reviewed: false,
      }),
    });
    expect(unmarked.status).toBe(200);
    expect(await pendingFile(secondSession)).toMatchObject({ reviewed: false });
  });

  test("shows a commit Review Mark in a Time Window covering that commit", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    const commit = repo.commit("initial");

    const tempHome = stateDir();
    const running = (
      await startFixtureServer({
        repo,
        stateDir: join(tempHome, ".diff4ac"),
      })
    ).running;

    const commitResponse = await request(
      running,
      `/api/commit?hash=${commit}`,
    );
    expect(commitResponse.status).toBe(200);
    const commitSet = (await commitResponse.json()) as ChangeSet;
    const file = commitSet.files[0];
    if (!file) {
      throw new Error("expected a changed file");
    }
    expect(file.reviewed).toBe(false);

    const marked = await request(running, "/api/review-mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: file.path,
        contentHash: file.contentHash,
        reviewed: true,
      }),
    });
    expect(marked.status).toBe(200);

    const query = new URLSearchParams({
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-01-02T00:00:00.000Z",
      preset: "custom",
      mode: "auto",
    });
    const windowResponse = await request(
      running,
      `/api/time-window?${query.toString()}`,
    );
    expect(windowResponse.status).toBe(200);
    const windowSet = (await windowResponse.json()) as ChangeSet;
    expect(windowSet.selection.kind).toBe("time-window");
    expect(windowSet.files).toHaveLength(1);
    expect(windowSet.files[0]).toMatchObject({
      path: file.path,
      contentHash: file.contentHash,
      reviewed: true,
    });
    expect(existsSync(join(repo.root, ".diff4ac"))).toBe(false);
  });

  test("rejects malformed Review Mark requests", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    repo.write("src/app.ts", "two\n");

    const directory = stateDir();
    const running = (
      await startFixtureServer({ repo, stateDir: directory })
    ).running;
    const file = await pendingFile(running);

    const invalid = [
      { path: "../escape", contentHash: file.contentHash, reviewed: true },
      { path: file.path, contentHash: "not-a-hash", reviewed: true },
      { path: file.path, contentHash: file.contentHash, reviewed: "yes" },
    ];

    for (const body of invalid) {
      const response = await request(running, "/api/review-mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});
