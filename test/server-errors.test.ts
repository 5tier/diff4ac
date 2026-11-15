import { describe, expect, test } from "bun:test";
import type { BranchList } from "../shared/types";
import {
  createFixtureRepo,
  type FixtureRepo,
} from "./helpers/fixture";
import {
  getJson,
  startFixtureServer,
} from "./helpers/server";

function repoWithCommits(): FixtureRepo {
  const repo = createFixtureRepo();
  repo.write("src/app.ts", "one\n");
  repo.commit("initial");
  repo.write("src/app.ts", "one\ntwo\n");
  repo.commit("second");
  return repo;
}

describe("typed git failures over HTTP", () => {
  test("a well-formed but missing commit is a 404 without git output", async () => {
    const repo = repoWithCommits();
    const running = (await startFixtureServer({ repo })).running;

    const response = await getJson<string>(
      running,
      "/api/commit?hash=deadbeef",
    );

    expect(response.status).toBe(404);
    expect(response.body).toContain(
      "commit deadbee was not found in this Repository",
    );
    expect(response.body).not.toContain("git ");
    expect(response.body).not.toContain("exit code");
  });

  test("a missing hash in a commit set is a 404 naming that commit", async () => {
    const repo = repoWithCommits();
    const first = repo.git(["rev-list", "--max-parents=0", "HEAD"]).trim();
    const running = (await startFixtureServer({ repo })).running;

    const response = await getJson<string>(
      running,
      `/api/commit-set?hashes=${first},deadbeef&mode=net`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toContain(
      "commit deadbee was not found in this Repository",
    );
    expect(response.body).not.toContain("git ");
    expect(response.body).not.toContain("exit code");
  });

  test("a missing commit Selection on file endpoints is a 404", async () => {
    const repo = repoWithCommits();
    const running = (await startFixtureServer({ repo })).running;

    for (const path of [
      "/api/file-diff?selection=commit&hash=deadbeef&path=src%2Fapp.ts",
      "/api/file-content?selection=commit&hash=deadbeef&path=src%2Fapp.ts&rev=deadbeef",
    ]) {
      const response = await getJson<string>(running, path);
      expect(response.status).toBe(404);
      expect(response.body).toContain(
        "commit deadbee was not found in this Repository",
      );
      expect(response.body).not.toContain("git ");
      expect(response.body).not.toContain("exit code");
    }
  });

  test("a branch with unrelated history is a typed 409", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("initial");
    repo.git(["checkout", "-q", "--orphan", "orphan"]);
    repo.git(["rm", "-rf", "."]);
    repo.write("orphan.txt", "orphan\n");
    repo.commit("orphan root");
    repo.git(["checkout", "-q", "main"]);

    const running = (await startFixtureServer({ repo })).running;

    const response = await getJson<string>(
      running,
      "/api/branch?name=orphan",
    );

    expect(response.status).toBe(409);
    expect(response.body).toBe("branch orphan shares no history with main");
    expect(response.body).not.toContain("git ");
    expect(response.body).not.toContain("exit code");
  });

  test("a stale configured Base Branch falls back for listing but not for a branch Change Set", async () => {
    const repo = createFixtureRepo();
    repo.write("base.txt", "base\n");
    repo.commit("initial");
    repo.git(["branch", "feature"]);

    const running = (await startFixtureServer({ repo })).running;
    (running.config as { baseBranch: string | null }).baseBranch = "missing";

    const list = await getJson<BranchList>(running, "/api/branches");
    expect(list.status).toBe(200);
    expect(list.body.baseBranch).toEqual({ name: "main", ref: "main" });

    const branch = await getJson<string>(
      running,
      "/api/branch?name=feature",
    );
    expect(branch.status).toBe(404);
    expect(branch.body).toBe('branch "missing" was not found');
  });

  test("a malformed hash is still a 400", async () => {
    const repo = repoWithCommits();
    const running = (await startFixtureServer({ repo })).running;

    const commit = await getJson<string>(
      running,
      "/api/commit?hash=nothex",
    );
    expect(commit.status).toBe(400);
    expect(commit.body).toBe("Bad request: a commit hash is required");

    const file = await getJson<string>(
      running,
      "/api/file-diff?selection=commit&hash=nothex&path=src%2Fapp.ts",
    );
    expect(file.status).toBe(400);
    expect(file.body).toBe("Bad request: a commit hash is required");
  });
});
