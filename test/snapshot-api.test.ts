import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardSnapshotPathMatches } from "../shared/api-contract";
import type {
  SnapshotPathMatch,
  SnapshotTreeEntry,
} from "../shared/types";
import {
  createFixtureRepo,
  type FixtureRepo,
} from "./helpers/fixture";
import {
  commitSelection,
  createSnapshotFixture,
  snapshotFile,
  snapshotQuery,
  tree,
  type SnapshotFixture,
} from "./helpers/snapshot-fixture";
import { getJson, getRaw, startFixtureServer } from "./helpers/server";

const repos: FixtureRepo[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

function snapshotFixture(): SnapshotFixture {
  const fixture = createSnapshotFixture();
  repos.push(fixture.repo);
  return fixture;
}

function byPath(entries: readonly SnapshotTreeEntry[]): Map<string, SnapshotTreeEntry> {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

describe("Snapshot tree", () => {
  test("lists Pending after and before, with ghosts, renames and noise", async () => {
    const { repo } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    const afterRoot = byPath(await tree(running, { selection: "pending" }, "after"));
    expect(afterRoot.get("src")?.kind).toBe("dir");
    expect(afterRoot.get("src")?.containsChanges).toBe(true);
    expect(afterRoot.get("old")?.containsChanges).toBe(true);
    expect(afterRoot.get("node_modules")?.noise).toBe(true);
    expect(afterRoot.get("link.ts")?.kind).toBe("symlink");

    const afterOld = byPath(
      await tree(running, { selection: "pending" }, "after", "old"),
    );
    expect(afterOld.get("move-new.ts")).toMatchObject({
      kind: "file",
      status: "renamed",
      oldPath: "old/move-old.txt",
    });
    expect(afterOld.get("move-old.txt")).toMatchObject({
      status: "deleted",
      renamedTo: "old/move-new.ts",
    });
    expect(afterOld.get("deleted.txt")).toMatchObject({ status: "deleted" });

    const afterSrc = byPath(
      await tree(running, { selection: "pending" }, "after", "src"),
    );
    expect(afterSrc.get("a.txt")?.status).toBe("modified");
    expect(afterSrc.get("untracked.ts")?.status).toBe("added");
    expect(afterSrc.get("deep")?.containsChanges).toBe(false);

    const beforeRoot = byPath(
      await tree(running, { selection: "pending" }, "before"),
    );
    expect(beforeRoot.get("src")?.containsChanges).toBe(true);
    expect(beforeRoot.get("old")?.containsChanges).toBe(true);
    const beforeSrc = byPath(
      await tree(running, { selection: "pending" }, "before", "src"),
    );
    expect(beforeSrc.has("untracked.ts")).toBe(false);

    const beforeOld = byPath(
      await tree(running, { selection: "pending" }, "before", "old"),
    );
    expect(beforeOld.get("move-old.txt")).toMatchObject({
      status: "renamed",
      renamedTo: "old/move-new.ts",
    });
    expect(beforeOld.get("deleted.txt")?.status).toBe("deleted");
    expect(beforeOld.has("move-new.ts")).toBe(false);
  });

  test("root commit before side is the empty tree", async () => {
    const { repo, initial } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    expect(await tree(running, commitSelection(initial), "before")).toEqual([]);
    const after = await tree(running, commitSelection(initial), "after");
    expect(after.map((entry) => entry.name)).toContain("src");
  });

  test("commit, commit-set, Time Window and branch scopes resolve", async () => {
    const { repo, initial, second, feature } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    for (const selection of [
      commitSelection(second),
      {
        selection: "commits",
        hashes: `${second},${initial}`,
        mode: "net",
      },
      {
        selection: "commits",
        hashes: `${second},${initial}`,
        mode: "stack",
      },
      {
        selection: "time-window",
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-03T00:00:00.000Z",
        preset: "custom",
        mode: "auto",
      },
      { selection: "branch", name: "feature" },
    ]) {
      for (const side of ["after", "before"]) {
        const root = await tree(running, selection, side);
        expect(Array.isArray(root)).toBe(true);
      }
    }

    const featureAfter = await tree(
      running,
      { selection: "branch", name: "feature" },
      "after",
      "src",
    );
    expect(featureAfter.map((entry) => entry.name)).toContain("feature.ts");
    expect(feature).not.toBe(second);
  });

  test("rejects unsafe dirs and missing scopes", async () => {
    const { repo } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;
    const base = "selection=pending&side=after";

    for (const dir of ["..%2Fescape", "%2Fetc", "src%2F..%2F..%2Fx"]) {
      const response = await getJson<unknown>(
        running,
        `/api/snapshot/tree?${base}&dir=${dir}`,
      );
      expect(response.status).toBe(400);
    }

    const missing = await getJson<unknown>(
      running,
      `/api/snapshot/tree?${base}&dir=missing`,
    );
    expect(missing.status).toBe(404);

    for (const dir of [".git", ".git/config", "sub/.git"]) {
      const internals = await getJson<unknown>(
        running,
        `/api/snapshot/tree?${base}&dir=${encodeURIComponent(dir)}`,
      );
      expect(internals.status).toBe(404);
    }

    for (const side of ["", "nope"]) {
      const response = await getJson<unknown>(
        running,
        `/api/snapshot/tree?selection=pending&side=${side}`,
      );
      expect(response.status).toBe(400);
    }

    const unknown = await getJson<unknown>(
      running,
      `/api/snapshot/tree?selection=commit&hash=deadbeef&side=after`,
    );
    expect(unknown.status).toBe(404);
  });
});

describe("Snapshot file content", () => {
  test("returns text, binary, image, symlink and submodule descriptors", async () => {
    const { repo, second } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    const after = await snapshotFile(
      running,
      commitSelection(second),
      "after",
      "src/a.txt",
    );
    expect(after).toMatchObject({
      kind: "file",
      binary: false,
      image: false,
      text: "alpha\nsecond\n",
    });

    const before = await snapshotFile(
      running,
      commitSelection(second),
      "before",
      "src/a.txt",
    );
    expect(before.text).toBe("alpha\n");

    const image = await snapshotFile(
      running,
      commitSelection(second),
      "after",
      "assets/logo.png",
    );
    expect(image).toMatchObject({ kind: "file", binary: true, image: true });
    expect(image.text).toBeUndefined();

    const binary = await snapshotFile(
      running,
      commitSelection(second),
      "after",
      "assets/raw.bin",
    );
    expect(binary).toMatchObject({
      kind: "file",
      binary: true,
      image: false,
    });
    expect(binary.text).toBeUndefined();

    const raw = await getRaw(
      running,
      `/api/snapshot/raw?${snapshotQuery(commitSelection(second), "after", {
        path: "assets/logo.png",
      })}`,
    );
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await raw.arrayBuffer())]).toEqual([
      0, 1, 2, 3,
    ]);

    const notImage = await getRaw(
      running,
      `/api/snapshot/raw?${snapshotQuery(commitSelection(second), "after", {
        path: "src/a.txt",
      })}`,
    );
    expect(notImage.status).toBe(404);

    const link = await snapshotFile(
      running,
      commitSelection(second),
      "after",
      "link.ts",
    );
    expect(link).toMatchObject({ kind: "symlink", text: "src/a.txt" });

  });

  test("returns a small descriptor for submodule entries", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    repo.write("src/a.txt", "alpha\n");
    const initial = repo.commit("initial");
    repo.git([
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${initial},vendor/lib`,
    ]);
    const withSubmodule = repo.commit("add submodule", { addAll: false });
    const running = (await startFixtureServer({ repo })).running;

    const submodule = await snapshotFile(
      running,
      commitSelection(withSubmodule),
      "after",
      "vendor/lib",
    );
    expect(submodule).toMatchObject({ kind: "submodule" });
    expect(submodule.submoduleOid).toMatch(/^[0-9a-f]{40,64}$/);
  });

  test("handles colons, leading dashes, spaces and unicode in paths", async () => {
    const { repo, second } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    const cases: readonly [string, string][] = [
      ["weird/a:b.txt", "colon second\n"],
      ["weird/-lead.txt", "dash second\n"],
      ["weird/a b.txt", "space second\n"],
      ["weird/üñï.txt", "unicode second\n"],
    ];
    for (const [path, text] of cases) {
      const file = await snapshotFile(
        running,
        commitSelection(second),
        "after",
        path,
      );
      expect(file.text, path).toBe(text);

      const diff = await getJson<{ diff: string }>(
        running,
        `/api/file-diff?selection=commit&hash=${second}&path=${encodeURIComponent(
          path,
        )}&rev=${second}`,
      );
      expect(diff.status, path).toBe(200);
      expect(diff.body.diff).toContain(`${text.trim()}`);
    }

    const pending = await snapshotFile(
      running,
      { selection: "pending" },
      "after",
      "weird/a:b.txt",
    );
    expect(pending.text).toBe("colon pending\n");

    const pendingDiff = await getJson<{ diff: string }>(
      running,
      `/api/file-diff?selection=pending&path=${encodeURIComponent(
        "weird/a:b.txt",
      )}&rev=worktree`,
    );
    expect(pendingDiff.status).toBe(200);
    expect(pendingDiff.body.diff).toContain("+colon pending");

    const pendingImage = await getRaw(
      running,
      `/api/file-content?selection=pending&path=${encodeURIComponent(
        "assets/a:b.png",
      )}&rev=worktree`,
    );
    expect(pendingImage.status).toBe(200);
    expect([...new Uint8Array(await pendingImage.arrayBuffer())]).toEqual([
      0, 8, 8, 8,
    ]);

    const commitImage = await getRaw(
      running,
      `/api/file-content?selection=commit&hash=${second}&path=${encodeURIComponent(
        "assets/a:b.png",
      )}&rev=${second}`,
    );
    expect(commitImage.status).toBe(200);
    expect([...new Uint8Array(await commitImage.arrayBuffer())]).toEqual([
      0, 9, 9,
    ]);
  });

  test("only serves paths that belong to the Snapshot", async () => {
    const { repo } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    for (const path of [
      ".env",
      "ignored.png",
      ".git/config",
      ".git/HEAD",
      "sub/.git/config",
    ]) {
      const file = await getJson<unknown>(
        running,
        `/api/snapshot/file?${snapshotQuery({ selection: "pending" }, "after", {
          path,
        })}`,
      );
      expect(file.status, path).toBe(404);
      const raw = await getRaw(
        running,
        `/api/snapshot/raw?${snapshotQuery({ selection: "pending" }, "after", {
          path,
        })}`,
      );
      expect(raw.status, path).toBe(404);
    }

    const tracked = await snapshotFile(
      running,
      { selection: "pending" },
      "after",
      "src/a.txt",
    );
    expect(tracked.text).toContain("pending");

    const untracked = await snapshotFile(
      running,
      { selection: "pending" },
      "after",
      "src/untracked.ts",
    );
    expect(untracked).toMatchObject({
      text: "untracked\n",
      status: "added",
    });
  });

  test("deleted files on the after side show the before content", async () => {
    const { repo } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    const deleted = await snapshotFile(
      running,
      { selection: "pending" },
      "after",
      "old/deleted.txt",
    );
    expect(deleted).toMatchObject({
      text: "bye\n",
      deleted: true,
      status: "deleted",
    });

    const renamedAway = await snapshotFile(
      running,
      { selection: "pending" },
      "after",
      "old/move-old.txt",
    );
    expect(renamedAway).toMatchObject({
      text: "one\ntwo\nthree\n",
      deleted: true,
      status: "deleted",
    });

    const missing = await getJson<unknown>(
      running,
      `/api/snapshot/file?${snapshotQuery({ selection: "pending" }, "after", {
        path: "nope.txt",
      })}`,
    );
    expect(missing.status).toBe(404);

    for (const path of ["../escape", "/etc/passwd"]) {
      const unsafe = await getJson<unknown>(
        running,
        `/api/snapshot/file?${snapshotQuery({ selection: "pending" }, "after", {
          path,
        })}`,
      );
      expect(unsafe.status).toBe(400);
    }
  });

  test("truncates text unless full is requested and enforces the full ceiling", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const lines = Array.from(
      { length: 30_000 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    repo.write("big.txt", `${lines}\n`);
    const commit = repo.commit("big");
    const running = (await startFixtureServer({ repo })).running;

    const capped = await snapshotFile(
      running,
      commitSelection(commit),
      "after",
      "big.txt",
    );
    expect(capped.truncated).toBe(true);
    expect(capped.totalLines).toBe(30_000);
    expect(capped.text?.split("\n").length).toBeLessThanOrEqual(20_001);

    const full = await snapshotFile(
      running,
      commitSelection(commit),
      "after",
      "big.txt",
      true,
    );
    expect(full.truncated).toBeUndefined();
    expect(full.text?.endsWith("line 30000\n")).toBe(true);

    const huge = Buffer.alloc(20_000_001, 0x61).toString("utf8");
    repo.write("huge.txt", huge);
    const hugeCommit = repo.commit("huge");
    const rejected = await getJson<unknown>(
      running,
      `/api/snapshot/file?${snapshotQuery(commitSelection(hugeCommit), "after", {
        path: "huge.txt",
        full: "1",
      })}`,
    );
    expect(rejected.status).toBe(413);
  }, 30_000);

  test("does not follow symlinks outside the Worktree", async () => {
    const { repo } = snapshotFixture();
    const outside = mkdtempSync(join(tmpdir(), "diff4ac-snapshot-outside-"));
    try {
      const secret = join(outside, "secret.txt");
      writeFileSync(secret, "outside\n");
      symlinkSync(outside, join(repo.root, "out"));

      const running = (await startFixtureServer({ repo })).running;
      const response = await getJson<unknown>(
        running,
        `/api/snapshot/file?${snapshotQuery({ selection: "pending" }, "after", {
          path: "out/secret.txt",
        })}`,
      );
      expect(response.status).toBe(404);

      const root = await tree(running, { selection: "pending" }, "after");
      expect(root.find((entry) => entry.path === "out")?.kind).toBe("symlink");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("Snapshot path search", () => {
  test("ranks paths and marks statuses", async () => {
    const { repo } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;

    const response = await getJson<unknown>(
      running,
      `/api/snapshot/paths?${snapshotQuery({ selection: "pending" }, "after", {
        q: "deep",
        limit: "10",
      })}`,
    );
    expect(response.status).toBe(200);
    const guarded = guardSnapshotPathMatches(response.body, "");
    if (!guarded.ok) {
      throw new Error(`${guarded.path} is not ${guarded.expected}`);
    }
    expect(guarded.value.map((match) => match.path)).toContain(
      "src/deep/b.txt",
    );

    const untracked = await getJson<SnapshotPathMatch[]>(
      running,
      `/api/snapshot/paths?${snapshotQuery({ selection: "pending" }, "after", {
        q: "untracked",
      })}`,
    );
    expect(untracked.body).toContainEqual({
      path: "src/untracked.ts",
      status: "added",
    });

    const tooLong = await getJson<unknown>(
      running,
      `/api/snapshot/paths?${snapshotQuery({ selection: "pending" }, "after", {
        q: "x".repeat(257),
      })}`,
    );
    expect(tooLong.status).toBe(400);
    const badLimit = await getJson<unknown>(
      running,
      `/api/snapshot/paths?${snapshotQuery({ selection: "pending" }, "after", {
        limit: "0",
      })}`,
    );
    expect(badLimit.status).toBe(400);
  });
});

describe("Snapshot read-only guarantee", () => {
  test("leaves git status unchanged", async () => {
    const { repo, initial, second } = snapshotFixture();
    const running = (await startFixtureServer({ repo })).running;
    const status = () =>
      repo.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const before = status();

    for (const selection of [
      { selection: "pending" },
      commitSelection(initial),
      commitSelection(second),
      { selection: "branch", name: "feature" },
    ]) {
      for (const side of ["after", "before"]) {
        await tree(running, selection, side);
        await getJson<unknown>(
          running,
          `/api/snapshot/paths?${snapshotQuery(selection, side, { q: "src" })}`,
        );
      }
    }
    await snapshotFile(running, { selection: "pending" }, "after", "src/a.txt");

    expect(status()).toBe(before);
  });
});
