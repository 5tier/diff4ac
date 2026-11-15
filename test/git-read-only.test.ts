import { afterEach, describe, expect, test } from "bun:test";
import { createTempDirectory } from "./helpers/cleanup";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";
import { startServer, type RunningServer } from "../src/server/server";
import type { ChangeSet } from "../shared/types";
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

function tempDirectory(prefix: string): string {
  return createTempDirectory(prefix);
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

describe("read-only diff generation", () => {
  test("never runs an external diff or textconv driver from the Repository", async () => {
    const repo = fixture();
    const work = tempDirectory("diff4ac-diff-safety-");
    const marker = join(work, "marker");
    const helper = join(work, "helper.sh");

    writeFileSync(
      helper,
      `#!/bin/sh\ntouch '${marker}'\necho 'HELPER-RAN'\n`,
    );
    chmodSync(helper, 0o755);

    repo.write("docs/raw.txt", "alpha\nbeta\ngamma\n");
    repo.write("src/move-old.txt", "one\ntwo\nthree\nfour\nfive\n");
    repo.commit("initial");
    repo.write("docs/raw.txt", "alpha\nBETA\ngamma\n");
    const second = repo.commit("second");

    repo.write("docs/raw.txt", "alpha\nBETA\ngamma\ndelta\n");
    repo.rename("src/move-old.txt", "src/move-new.txt");
    repo.write(
      "src/move-new.txt",
      "one\nTWO\nthree\nfour\nfive\nsix\n",
    );

    // Prove the fixture really can execute both drivers before the server
    // starts, then remove the marker.
    repo.git(["config", "diff.external", helper]);
    repo.git(["config", "diff.raw.textconv", helper]);
    mkdirSync(join(repo.root, ".git", "info"), { recursive: true });
    writeFileSync(join(repo.root, ".git", "info", "attributes"), "*.txt diff=raw\n");

    try {
      const externalDiff = repo.git(["diff", "--ext-diff", "--no-color"]);
      expect(statSync(marker).isFile()).toBe(true);
      expect(externalDiff).toContain("HELPER-RAN");
      rmSync(marker);

      repo.git(["diff", "--no-ext-diff", "--no-color"]);
      expect(statSync(marker).isFile()).toBe(true);
      rmSync(marker);
    } catch (error) {
      throw new Error(
        `fixture cannot run the configured diff drivers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const home = createTempHome();
    homes.push(home);
    const running = await startServer({
      repoPath: repo.root,
      homeDir: home.path,
      stateDir: tempDirectory("diff4ac-diff-safety-state-"),
    });
    servers.push(running);

    const pending = await getJson<ChangeSet>(running, "/api/pending");
    expect(existsSync(marker)).toBe(false);

    const modified = pending.body.files.find(
      (file) => file.path === "docs/raw.txt",
    );
    expect(modified?.diff).toContain("+delta");
    expect(modified?.diff).not.toContain("HELPER-RAN");

    const renamed = pending.body.files.find(
      (file) => file.path === "src/move-new.txt",
    );
    expect(renamed?.status).toBe("renamed");
    expect(renamed?.diff).toContain("rename from src/move-old.txt");
    expect(renamed?.diff).toContain("+TWO");
    expect(renamed?.diff).toContain("+six");
    expect(renamed?.diff).not.toContain("HELPER-RAN");
    expect(existsSync(marker)).toBe(false);

    const commit = await getJson<ChangeSet>(
      running,
      `/api/commit?hash=${second}`,
    );
    expect(existsSync(marker)).toBe(false);

    const committed = commit.body.files.find(
      (file) => file.path === "docs/raw.txt",
    );
    expect(committed?.diff).toContain("-beta");
    expect(committed?.diff).toContain("+BETA");
    expect(committed?.diff).not.toContain("HELPER-RAN");

    // The file-diff endpoint rebuilds the same single file through the same
    // gateway; keep it covered too.
    const single = await getJson<{ diff: string }>(
      running,
      `/api/file-diff?selection=commit&hash=${second}&path=docs%2Fraw.txt&context=full`,
    );
    expect(single.body.diff).toContain("+BETA");
    expect(single.body.diff).not.toContain("HELPER-RAN");
    expect(existsSync(marker)).toBe(false);
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
  const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    headers: { "x-diff4ac-token": running.token },
  });
  const text = await response.text();
  expect(response.status).toBe(200);
  return { status: response.status, body: JSON.parse(text) as T };
}
