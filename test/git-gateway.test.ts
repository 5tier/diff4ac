import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitGateway, NotAGitRepositoryError } from "../src/git/gateway";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

describe("Git Gateway", () => {
  test("refuses mutating git subcommands", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("initial");
    const git = await GitGateway.open(repo.root);

    let message = "";
    try {
      await git.run(["commit", "--allow-empty", "-m", "should not run"]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("refuses to run non-read-only git command");
    expect(repo.git(["log", "--format=%s"]).trim()).toBe("initial");
  });

  test("reports when a path is not inside a Repository", async () => {
    const outside = mkdtempSync(join(tmpdir(), "diff4ac-outside-"));

    try {
      let error: unknown;
      try {
        await GitGateway.open(outside);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(NotAGitRepositoryError);
      expect((error as Error).message).toContain(
        "is not inside a git Repository",
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("fixtures produce deterministic commits", () => {
    const first = fixture();
    first.write("a.txt", "same\n");
    const firstHash = first.commit("same message");

    const second = fixture();
    second.write("a.txt", "same\n");
    const secondHash = second.commit("same message");

    expect(firstHash).toBe(secondHash);
  });
});
