import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { buildCommitChangeSet } from "../src/changeset/commit";
import { buildCommitsChangeSet } from "../src/changeset/commits";
import { buildPendingChangeSet } from "../src/changeset/pending";
import {
  describeModeChange,
  isModeOnlyChange,
} from "../src/diff/mode";
import { GitGateway } from "../src/git/gateway";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  repo.git(["config", "core.fileMode", "true"]);
  return repo;
}

function executable(repo: FixtureRepo, path: string): void {
  chmodSync(join(repo.root, path), 0o755);
}

function nonExecutable(repo: FixtureRepo, path: string): void {
  chmodSync(join(repo.root, path), 0o644);
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

describe("Mode changes", () => {
  test("reports a mode-only Pending change", async () => {
    const repo = fixture();
    repo.write("bin/run.sh", "echo run\n");
    repo.commit("base");
    executable(repo, "bin/run.sh");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files.find(
      (candidate) => candidate.path === "bin/run.sh",
    );

    expect(file).toMatchObject({
      path: "bin/run.sh",
      status: "modified",
      oldMode: "100644",
      newMode: "100755",
      additions: 0,
      deletions: 0,
      binary: false,
    });
    expect(file?.hunks).toEqual([]);
    expect(file?.diff).toContain("old mode 100644");
    expect(file?.diff).toContain("new mode 100755");
    if (!file) {
      throw new Error("expected a mode-only file");
    }
    expect(isModeOnlyChange(file)).toBe(true);
    expect(
      describeModeChange({
        oldMode: file.oldMode ?? "",
        newMode: file.newMode ?? "",
      }),
    ).toBe("Mode changed: 100644 → 100755 (now executable)");
  });

  test("reports a mode plus content Pending change", async () => {
    const repo = fixture();
    repo.write("bin/build.sh", "echo build\n");
    repo.commit("base");
    executable(repo, "bin/build.sh");
    repo.write("bin/build.sh", "echo build\necho done\n");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files.find(
      (candidate) => candidate.path === "bin/build.sh",
    );

    expect(file).toMatchObject({
      oldMode: "100644",
      newMode: "100755",
      additions: 1,
      deletions: 0,
    });
    expect(file?.hunks).toHaveLength(1);
    expect(file?.diff).toContain("old mode 100644");
    expect(file?.diff).toContain("new mode 100755");
    expect(file?.diff).toContain("+echo done");
    if (!file) {
      throw new Error("expected a mode and content file");
    }
    expect(isModeOnlyChange(file)).toBe(false);
  });

  test("carries old and new mode on a single commit", async () => {
    const repo = fixture();
    repo.write("bin/run.sh", "echo run\n");
    repo.write("bin/build.sh", "echo build\n");
    repo.commit("base");

    executable(repo, "bin/run.sh");
    executable(repo, "bin/build.sh");
    repo.write("bin/build.sh", "echo build\necho done\n");
    const commit = repo.commit("modes and content");

    const changeSet = await buildCommitChangeSet(
      await GitGateway.open(repo.root),
      commit,
    );
    const modeOnly = changeSet.files.find(
      (candidate) => candidate.path === "bin/run.sh",
    );
    const modeAndContent = changeSet.files.find(
      (candidate) => candidate.path === "bin/build.sh",
    );

    expect(modeOnly).toMatchObject({
      oldMode: "100644",
      newMode: "100755",
      additions: 0,
      deletions: 0,
    });
    expect(modeOnly?.hunks).toEqual([]);
    expect(modeAndContent).toMatchObject({
      oldMode: "100644",
      newMode: "100755",
      additions: 1,
      deletions: 0,
    });
    expect(modeAndContent?.hunks).toHaveLength(1);
  });

  test("carries modes through a Commit Stack and a Net Diff", async () => {
    const repo = fixture();
    repo.write("bin/task.sh", "echo one\n");
    repo.write("bin/other.sh", "echo other\n");
    repo.commit("base");

    executable(repo, "bin/task.sh");
    const modeOnlyCommit = repo.commit("make task executable");

    repo.write("bin/task.sh", "echo one\necho two\n");
    executable(repo, "bin/other.sh");
    repo.write("bin/other.sh", "echo other\necho more\n");
    const modeAndContentCommit = repo.commit("content and other mode");

    const git = await GitGateway.open(repo.root);
    const stack = await buildCommitsChangeSet(
      git,
      [modeOnlyCommit, modeAndContentCommit],
      "stack",
    );
    const firstGroup = stack.commitGroups?.find(
      (group) => group.commit.hash === modeOnlyCommit,
    );
    const secondGroup = stack.commitGroups?.find(
      (group) => group.commit.hash === modeAndContentCommit,
    );

    expect(firstGroup?.files).toHaveLength(1);
    expect(firstGroup?.files[0]).toMatchObject({
      path: "bin/task.sh",
      oldMode: "100644",
      newMode: "100755",
      additions: 0,
      deletions: 0,
    });
    expect(firstGroup?.files[0]?.hunks).toEqual([]);

    const stackedTask = secondGroup?.files.find(
      (file) => file.path === "bin/task.sh",
    );
    expect(stackedTask).toMatchObject({
      additions: 1,
      deletions: 0,
    });
    expect(stackedTask?.oldMode).toBeUndefined();
    expect(stackedTask?.newMode).toBeUndefined();

    const stackedOther = secondGroup?.files.find(
      (file) => file.path === "bin/other.sh",
    );
    expect(stackedOther).toMatchObject({
      oldMode: "100644",
      newMode: "100755",
      additions: 1,
      deletions: 0,
    });

    const net = await buildCommitsChangeSet(
      git,
      [modeOnlyCommit, modeAndContentCommit],
      "net",
    );
    const netTask = net.files.find((file) => file.path === "bin/task.sh");
    const netOther = net.files.find((file) => file.path === "bin/other.sh");

    expect(netTask).toMatchObject({
      oldMode: "100644",
      newMode: "100755",
      additions: 1,
      deletions: 0,
    });
    expect(netTask?.hunks).toHaveLength(1);
    expect(netOther).toMatchObject({
      oldMode: "100644",
      newMode: "100755",
      additions: 1,
      deletions: 0,
    });
  });

  test("describes a file that is no longer executable", () => {
    expect(
      describeModeChange({ oldMode: "100755", newMode: "100644" }),
    ).toBe("Mode changed: 100755 → 100644 (no longer executable)");
    expect(
      describeModeChange({ oldMode: "100644", newMode: "100600" }),
    ).toBe("Mode changed: 100644 → 100600");
  });

  test("does not treat a non-executable mode change as executable", async () => {
    const repo = fixture();
    repo.write("bin/run.sh", "echo run\n");
    executable(repo, "bin/run.sh");
    repo.commit("executable base");
    nonExecutable(repo, "bin/run.sh");

    const changeSet = await buildPendingChangeSet(
      await GitGateway.open(repo.root),
    );
    const file = changeSet.files.find(
      (candidate) => candidate.path === "bin/run.sh",
    );

    expect(file).toMatchObject({
      oldMode: "100755",
      newMode: "100644",
      additions: 0,
      deletions: 0,
    });
    expect(file?.oldMode).toBe("100755");
    expect(file?.newMode).toBe("100644");
    if (!file) {
      throw new Error("expected a mode-only file");
    }
    expect(
      describeModeChange({
        oldMode: file.oldMode ?? "",
        newMode: file.newMode ?? "",
      }),
    ).toBe("Mode changed: 100755 → 100644 (no longer executable)");
  });
});
