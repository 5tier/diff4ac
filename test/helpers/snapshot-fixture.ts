import { symlinkSync } from "node:fs";
import { join } from "node:path";
import type { RunningServer } from "../../src/server/server";
import {
  guardSnapshotFile,
  guardSnapshotTree,
} from "../../shared/api-contract";
import type {
  SnapshotFile,
  SnapshotTreeEntry,
} from "../../shared/types";
import { createFixtureRepo, type FixtureRepo } from "./fixture";
import { getJson } from "./server";

export function buffer(...values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

export interface SnapshotFixture {
  readonly repo: FixtureRepo;
  readonly initial: string;
  readonly second: string;
  readonly feature: string;
}

export function createSnapshotFixture(): SnapshotFixture {
  const repo = createFixtureRepo();

  repo.write("src/a.txt", "alpha\n");
  repo.write("src/deep/b.txt", "beta\n");
  repo.write("node_modules/pkg/x.js", "noise\n");
  repo.write("old/deleted.txt", "bye\n");
  repo.write("old/move-old.txt", "one\ntwo\nthree\n");
  repo.write("assets/logo.png", buffer(0, 1, 2, 3));
  repo.write("assets/raw.bin", buffer(0, 1, 2, 3));
  repo.write(".gitignore", ".env\nignored.png\n");
  repo.write(".env", "API_KEY=secret\n");
  repo.write("ignored.png", buffer(0, 1, 2, 3));
  symlinkSync("src/a.txt", join(repo.root, "link.ts"));
  const initial = repo.commit("initial");

  repo.write("src/a.txt", "alpha\nsecond\n");
  const second = repo.commit("second");

  repo.git(["checkout", "-q", "-b", "feature"]);
  repo.write("src/feature.ts", "feature\n");
  const feature = repo.commit("feature work");
  repo.git(["checkout", "-q", "main"]);

  repo.write("src/a.txt", "alpha\nsecond\npending\n");
  repo.remove("old/deleted.txt");
  repo.rename("old/move-old.txt", "old/move-new.ts");
  repo.write("old/move-new.ts", "one\nTWO\nthree\nfour\n");
  repo.write("src/untracked.ts", "untracked\n");

  return { repo, initial, second, feature };
}

export function snapshotQuery(
  selection: Record<string, string>,
  side: string,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ ...selection, side, ...extra });
  return params.toString();
}

export function commitSelection(hash: string): Record<string, string> {
  return { selection: "commit", hash };
}

export async function tree(
  running: RunningServer,
  selection: Record<string, string>,
  side: string,
  dir = "",
): Promise<readonly SnapshotTreeEntry[]> {
  const response = await getJson<unknown>(
    running,
    `/api/snapshot/tree?${snapshotQuery(selection, side, dir ? { dir } : {})}`,
  );
  if (response.status !== 200) {
    throw new Error(`${response.status}: ${String(response.body)}`);
  }
  const guarded = guardSnapshotTree(response.body, "");
  if (!guarded.ok) {
    throw new Error(`${guarded.path} is not ${guarded.expected}`);
  }
  return guarded.value;
}

export async function snapshotFile(
  running: RunningServer,
  selection: Record<string, string>,
  side: string,
  path: string,
  full = false,
): Promise<SnapshotFile> {
  const response = await getJson<unknown>(
    running,
    `/api/snapshot/file?${snapshotQuery(selection, side, {
      path,
      ...(full ? { full: "1" } : {}),
    })}`,
  );
  if (response.status !== 200) {
    throw new Error(`${response.status}: ${String(response.body)}`);
  }
  const guarded = guardSnapshotFile(response.body, "");
  if (!guarded.ok) {
    throw new Error(`${guarded.path} is not ${guarded.expected}`);
  }
  return guarded.value;
}
