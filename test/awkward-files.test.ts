import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommitChangeSet } from "../src/changeset/commit";
import { buildPendingChangeSet } from "../src/changeset/pending";
import { GitGateway } from "../src/git/gateway";
import { repositoryIdentity } from "../src/repository/identity";
import {
  annotateChangeSet,
  ReviewMarkStore,
} from "../src/review/marks";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeFile, ChangeSet } from "../shared/types";
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
  const directory = mkdtempSync(join(tmpdir(), "diff4ac-awkward-"));
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

describe("Renames", () => {
  test("shows a rename with edits as old path to new path and only real changes", async () => {
    const repo = fixture();
    repo.write(
      "src/old-name.ts",
      "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    );
    repo.commit("initial");
    repo.rename("src/old-name.ts", "src/new-name.ts", { stage: true });
    repo.write(
      "src/new-name.ts",
      "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\n",
      { stage: true },
    );
    const renameCommit = repo.commit("rename and edit");

    const changeSet = await buildCommitChangeSet(
      await GitGateway.open(repo.root),
      renameCommit,
    );
    const file = changeSet.files[0];
    if (!file) {
      throw new Error("expected a renamed file");
    }

    expect(file).toMatchObject({
      path: "src/new-name.ts",
      oldPath: "src/old-name.ts",
      status: "renamed",
      binary: false,
      additions: 2,
      deletions: 1,
    });
    expect(file.diff).toContain("rename from src/old-name.ts");
    expect(file.diff).toContain("rename to src/new-name.ts");
    expect(file.diff).toContain("-beta");
    expect(file.diff).toContain("+BETA");
    expect(file.diff).toContain("+zeta");
    expect(file.diff).not.toContain("+alpha");
  });

  test("detects a staged rename in Pending changes", async () => {
    const repo = fixture();
    repo.write("src/before.ts", "one\ntwo\nthree\n");
    repo.commit("initial");
    repo.rename("src/before.ts", "src/after.ts", { stage: true });
    repo.write("src/after.ts", "one\ntwo\nTHREE\n", { stage: true });

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files[0];

    expect(file).toMatchObject({
      path: "src/after.ts",
      oldPath: "src/before.ts",
      status: "renamed",
    });
    expect(file?.diff).toContain("rename from src/before.ts");
    expect(file?.diff).toContain("rename to src/after.ts");
  });
});

describe("Binary files", () => {
  test("reports binary changes with old and new sizes and no garbage text", async () => {
    const repo = fixture();
    repo.write("assets/icon.bin", buffer(0, 1, 2, 3));
    repo.commit("initial");
    repo.write("assets/icon.bin", buffer(0, 1, 2, 3, 4, 5, 6));

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files[0];

    expect(file).toMatchObject({
      path: "assets/icon.bin",
      binary: true,
      image: false,
      additions: 0,
      deletions: 0,
      oldSize: 4,
      newSize: 7,
    });
    expect(file?.hunks).toEqual([]);
    expect(file?.diff).not.toContain("\0");
  });
});

describe("Image previews", () => {
  test("serves before and after images from commits with strict headers", async () => {
    const repo = fixture();
    const oldImage = buffer(0, 10, 20, 30, 0);
    const newImage = buffer(0, 40, 50, 60, 70, 0);
    repo.write("assets/logo.png", oldImage);
    repo.commit("old image");
    repo.write("assets/logo.png", newImage);
    const newCommit = repo.commit("new image");

    const running = await start(repo);
    const changeSetResponse = await getJson<ChangeSet>(
      running,
      `/api/commit?hash=${newCommit}`,
    );
    expect(changeSetResponse.status).toBe(200);
    const file = changeSetResponse.body.files[0];
    if (!file) {
      throw new Error("expected an image file");
    }

    expect(file).toMatchObject({
      path: "assets/logo.png",
      binary: true,
      image: true,
      oldSize: oldImage.byteLength,
      newSize: newImage.byteLength,
    });
    expect(file.oldRev).toBeDefined();
    expect(file.newRev).toBe(newCommit);

    const after = await getRaw(
      running,
      `/api/file-content?selection=commit&hash=${newCommit}&path=assets%2Flogo.png&rev=${file.newRev}`,
    );
    expect(after.status).toBe(200);
    expect(after.headers.get("content-type")).toBe("image/png");
    expect(after.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(after.bytes)]).toEqual([...newImage]);

    const before = await getRaw(
      running,
      `/api/file-content?selection=commit&hash=${newCommit}&path=assets%2Flogo.png&rev=${file.oldRev}`,
    );
    expect(before.status).toBe(200);
    expect([...new Uint8Array(before.bytes)]).toEqual([...oldImage]);
  });

  test("serves Pending before and after images", async () => {
    const repo = fixture();
    const oldImage = buffer(0, 1, 1, 1, 0);
    const newImage = buffer(0, 2, 2, 2, 2, 0);
    repo.write("assets/pending.png", oldImage);
    repo.commit("old pending image");
    repo.write("assets/pending.png", newImage);

    const running = await start(repo);
    const pending = await getJson<ChangeSet>(running, "/api/pending");
    const file = pending.body.files[0];
    if (!file) {
      throw new Error("expected a pending image");
    }
    expect(file).toMatchObject({
      path: "assets/pending.png",
      image: true,
      oldSize: oldImage.byteLength,
      newSize: newImage.byteLength,
    });
    expect(file.newRev).toBe("worktree");
    expect(file.oldRev).toMatch(/^[0-9a-f]{40,64}$/);

    const before = await getRaw(
      running,
      `/api/file-content?selection=pending&path=assets%2Fpending.png&rev=${file.oldRev}`,
    );
    expect(before.status).toBe(200);
    expect([...new Uint8Array(before.bytes)]).toEqual([...oldImage]);

    const after = await getRaw(
      running,
      `/api/file-content?selection=pending&path=assets%2Fpending.png&rev=worktree`,
    );
    expect(after.status).toBe(200);
    expect([...new Uint8Array(after.bytes)]).toEqual([...newImage]);
  });

  test("serves SVG with a no-scripts Content-Security-Policy", async () => {
    const repo = fixture();
    repo.write(
      "assets/icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>\n',
    );
    repo.commit("old svg");
    repo.write(
      "assets/icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><text>new</text></svg>\n',
    );
    const newCommit = repo.commit("new svg");

    const running = await start(repo);
    const changeSetResponse = await getJson<ChangeSet>(
      running,
      `/api/commit?hash=${newCommit}`,
    );
    const file = changeSetResponse.body.files[0];
    if (!file) {
      throw new Error("expected an image file");
    }

    expect(file).toMatchObject({
      path: "assets/icon.svg",
      image: true,
    });

    const response = await getRaw(
      running,
      `/api/file-content?selection=commit&hash=${newCommit}&path=assets%2Ficon.svg&rev=${file.newRev}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).not.toContain("script-src 'self'");
  });

  test("rejects missing tokens, bad revisions, hidden paths and escaping symlinks", async () => {
    const repo = fixture();
    repo.write("assets/logo.png", buffer(0, 1, 2));
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    repo.write("assets/logo.png", buffer(0, 1, 2, 3));
    repo.write("src/app.ts", "two\n");

    const running = await start(repo);
    const changeSetResponse = await getJson<ChangeSet>(running, "/api/pending");
    const image = changeSetResponse.body.files.find(
      (file) => file.path === "assets/logo.png",
    );
    if (!image) {
      throw new Error("expected a pending image");
    }

    const noToken = await fetch(
      `http://127.0.0.1:${running.port}/api/file-content?selection=pending&path=assets%2Flogo.png&rev=worktree`,
    );
    expect(noToken.status).toBe(401);

    const badRevs = ["HEAD", "--no-pager", "refs/heads/main"];
    for (const rev of badRevs) {
      const response = await getJson<ChangeSet>(
        running,
        `/api/file-content?selection=pending&path=assets%2Flogo.png&rev=${encodeURIComponent(rev)}`,
      );
      expect(response.status).toBe(400);
    }

    const outsideChangeSet = await getJson<ChangeSet>(
      running,
      `/api/file-content?selection=pending&path=src%2Fother.png&rev=worktree`,
    );
    expect(outsideChangeSet.status).toBe(404);

    const traversal = await getJson<ChangeSet>(
      running,
      `/api/file-content?selection=pending&path=..%2Fescape.png&rev=worktree`,
    );
    expect(traversal.status).toBe(400);

    const windowsTraversal = await getJson<ChangeSet>(
      running,
      `/api/file-content?selection=pending&path=..%5Cescape.png&rev=worktree`,
    );
    expect(windowsTraversal.status).toBe(400);

    const absolute = await getJson<ChangeSet>(
      running,
      `/api/file-content?selection=pending&path=%2Fetc%2Fpasswd&rev=worktree`,
    );
    expect(absolute.status).toBe(400);

    const nonImage = await getJson<ChangeSet>(
      running,
      `/api/file-content?selection=pending&path=src%2Fapp.ts&rev=worktree`,
    );
    expect(nonImage.status).toBe(404);

    const outside = join(tempDirectory(), "secret.png");
    writeFileSync(outside, buffer(0, 9, 9, 9));
    symlinkSync(outside, join(repo.root, "assets/escape.png"));

    const escaped = await getJson<ChangeSet>(
      running,
      `/api/file-content?selection=pending&path=assets%2Fescape.png&rev=worktree`,
    );
    expect(escaped.status).toBe(404);
  });
});

describe("Large diffs", () => {
  function bigFile(prefix: string): string {
    return Array.from({ length: 1600 }, (_, index) => `${prefix} ${index + 1}`)
      .join("\n");
  }

  test("collapses oversized file diffs but keeps Review Mark hashes correct", async () => {
    const repo = fixture();
    repo.write("src/huge.txt", `${bigFile("old")}\n`);
    repo.commit("initial");
    repo.write("src/huge.txt", `${bigFile("new")}\n`);

    const git = await GitGateway.open(repo.root);
    const collapsedSet = await buildPendingChangeSet(git);
    const collapsed = collapsedSet.files[0];
    if (!collapsed) {
      throw new Error("expected an oversized file");
    }

    expect(collapsed).toMatchObject({
      path: "src/huge.txt",
      collapsed: true,
      diff: "",
      hunks: [],
      additions: 1600,
      deletions: 1600,
    });

    const fullSet = await buildPendingChangeSet(git, {
      includeLargeDiffs: true,
    });
    const full = fullSet.files[0];
    if (!full) {
      throw new Error("expected an oversized file");
    }

    expect(full.collapsed).toBeUndefined();
    expect(full.hunks.length).toBeGreaterThan(0);
    expect(full.diff).toContain("+new 1");
    expect(full.contentHash).toBe(collapsed.contentHash);

    const directory = tempDirectory();
    const repositoryId = await repositoryIdentity(git);
    const store = new ReviewMarkStore(directory);
    store.setMarked(
      repositoryId,
      collapsed.path,
      collapsed.contentHash,
      true,
    );

    const annotatedCollapsed = annotateChangeSet(
      collapsedSet,
      store,
      repositoryId,
    );
    expect(annotatedCollapsed.files[0]?.reviewed).toBe(true);
    expect(
      annotateChangeSet(fullSet, store, repositoryId).files[0]?.reviewed,
    ).toBe(true);
  });

  test("loads a collapsed file through the per-file endpoint", async () => {
    const repo = fixture();
    repo.write("src/huge.txt", `${bigFile("old")}\n`);
    repo.commit("initial");
    repo.write("src/huge.txt", `${bigFile("new")}\n`);

    const running = await start(repo);
    const pending = await getJson<ChangeSet>(running, "/api/pending");
    const collapsed = pending.body.files[0];
    if (!collapsed) {
      throw new Error("expected an oversized file");
    }
    expect(collapsed.collapsed).toBe(true);

    const loaded = await getJson<ChangeFile>(
      running,
      `/api/file-diff?selection=pending&path=${encodeURIComponent(
        collapsed.path,
      )}&rev=${collapsed.newRev}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.path).toBe(collapsed.path);
    expect(loaded.body.collapsed).toBeUndefined();
    expect(loaded.body.hunks.length).toBeGreaterThan(0);
    expect(loaded.body.contentHash).toBe(collapsed.contentHash);

    const markResponse = await fetch(
      `http://127.0.0.1:${running.port}/api/review-mark`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-diff4ac-token": running.token,
        },
        body: JSON.stringify({
          path: collapsed.path,
          contentHash: collapsed.contentHash,
          reviewed: true,
        }),
      },
    );
    expect(markResponse.status).toBe(200);

    const refreshed = await getJson<ChangeSet>(running, "/api/pending");
    expect(refreshed.body.files[0]?.reviewed).toBe(true);

    const markedFull = await getJson<ChangeFile>(
      running,
      `/api/file-diff?selection=pending&path=${encodeURIComponent(
        collapsed.path,
      )}&rev=${collapsed.newRev}`,
    );
    expect(markedFull.body.reviewed).toBe(true);
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
  headers: Record<string, string> = {},
): Promise<{
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: ArrayBuffer;
}> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `http://127.0.0.1:${running.port}${path}${separator}token=${encodeURIComponent(
      running.token,
    )}`,
    { headers },
  );
  return {
    status: response.status,
    headers: response.headers,
    bytes: await response.arrayBuffer(),
  };
}

test("keeps the token check on image routes", async () => {
  const repo = fixture();
  repo.write("assets/logo.png", buffer(0, 1, 2));
  repo.commit("initial");
  repo.write("assets/logo.png", buffer(0, 1, 2, 3));

  const running = await start(repo);
  const response = await fetch(
    `http://127.0.0.1:${running.port}/api/file-content?selection=pending&path=assets%2Flogo.png&rev=worktree`,
  );
  expect(response.status).toBe(401);
});

test("reads file contents from the index side for Pending changes", async () => {
  const repo = fixture();
  repo.write("assets/logo.png", buffer(0, 1, 2));
  repo.commit("initial");
  repo.write("assets/logo.png", buffer(0, 1, 2, 3), { stage: true });

  const running = await start(repo);
  const response = await getRaw(
    running,
    "/api/file-content?selection=pending&path=assets%2Flogo.png&rev=index",
  );
  expect(response.status).toBe(200);
  expect([...new Uint8Array(response.bytes)]).toEqual([
    ...buffer(0, 1, 2, 3),
  ]);
});

test("does not read a file outside the Change Set", async () => {
  const repo = fixture();
  repo.write("assets/logo.png", buffer(0, 1, 2));
  repo.write("assets/other.png", buffer(0, 3, 4));
  repo.commit("initial");
  repo.write("assets/logo.png", buffer(0, 1, 2, 3));

  const running = await start(repo);
  const response = await getRaw(
    running,
    "/api/file-content?selection=pending&path=assets%2Fother.png&rev=worktree",
  );
  expect(response.status).toBe(404);
});

test("reads committed content read-only without checking out", async () => {
  const repo = fixture();
  repo.write("assets/logo.png", buffer(0, 1, 2));
  repo.commit("initial");
  repo.write("assets/logo.png", buffer(0, 1, 2, 3));
  const newCommit = repo.commit("update");

  const running = await start(repo);
  const response = await getRaw(
    running,
    `/api/file-content?selection=commit&hash=${newCommit}&path=assets%2Flogo.png&rev=${newCommit}`,
  );
  expect(response.status).toBe(200);
  expect([...new Uint8Array(response.bytes)]).toEqual([
    ...buffer(0, 1, 2, 3),
  ]);
  expect(repo.git(["status", "--porcelain=v1"]).trim()).toBe("");
});

test("serves HEAD requests for images without a body", async () => {
  const repo = fixture();
  repo.write("assets/logo.png", buffer(0, 1, 2));
  repo.commit("initial");
  repo.write("assets/logo.png", buffer(0, 1, 2, 3));

  const running = await start(repo);
  const response = await fetch(
    `http://127.0.0.1:${running.port}/api/file-content?selection=pending&path=assets%2Flogo.png&rev=worktree&token=${encodeURIComponent(
      running.token,
    )}`,
    { method: "HEAD" },
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
  expect(response.headers.get("content-type")).toBe("image/png");
});
