import { afterEach, describe, expect, test } from "bun:test";
import { createTempDirectory } from "./helpers/cleanup";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { GitGateway, NotAGitRepositoryError } from "../src/git/gateway";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const SRC = join(import.meta.dir, "..", "src");
const GATEWAY = join(SRC, "git", "gateway.ts");

const repos: FixtureRepo[] = [];
const directories: string[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function tempDirectory(): string {
  const directory = createTempDirectory("diff4ac-gateway-");
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function rejectionMessage(
  git: GitGateway,
  args: readonly string[],
): Promise<string> {
  try {
    await git.run(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

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

  test("only allows reading core.fileMode from git config", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("initial");
    const git = await GitGateway.open(repo.root);

    const attempts: readonly (readonly string[])[] = [
      ["config", "core.fileMode", "false"],
      ["config", "--bool", "--get", "user.name"],
      ["config", "--bool", "--get", "core.fileMode", "false"],
      ["config", "--unset", "core.fileMode"],
    ];
    for (const args of attempts) {
      let message = "";
      try {
        await git.run(args);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("only reads core.fileMode");
    }

    const result = await git.run(
      ["config", "--bool", "--get", "core.fileMode"],
      { allowExitCodes: [0, 1] },
    );
    expect([0, 1]).toContain(result.exitCode);
  });

  test("reports when a path is not inside a Repository", async () => {
    const outside = createTempDirectory("diff4ac-outside-");

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

describe("read-only option guard", () => {
  const rejectedOptions: readonly [string, readonly string[]][] = [
    ["diff --output=x", ["diff", "--output=x"]],
    ["log --output x", ["log", "--output", "x"]],
    ["diff --ext-diff", ["diff", "--ext-diff"]],
    ["show --textconv", ["show", "--textconv"]],
    ["run diff --no-index", ["diff", "--no-index", "a", "b"]],
    ["cat-file --textconv", ["cat-file", "--textconv", "HEAD:a.txt"]],
    ["cat-file --filters", ["cat-file", "--filters", "HEAD:a.txt"]],
  ];

  for (const [label, args] of rejectedOptions) {
    test(`rejects ${label}`, async () => {
      const repo = fixture();
      repo.write("a.txt", "a\n");
      repo.commit("initial");
      const git = await GitGateway.open(repo.root);

      const message = await rejectionMessage(git, args);
      expect(message).toContain("disallowed option");
    });
  }

  const rejectedSymbolicRefs: readonly [string, readonly string[]][] = [
    ["symbolic-ref -d HEAD", ["symbolic-ref", "-d", "HEAD"]],
    ["symbolic-ref --delete HEAD", ["symbolic-ref", "--delete", "HEAD"]],
    ["symbolic-ref HEAD refs/heads/x", ["symbolic-ref", "HEAD", "refs/heads/x"]],
    [
      "symbolic-ref -m msg HEAD refs/heads/x",
      ["symbolic-ref", "-m", "msg", "HEAD", "refs/heads/x"],
    ],
    [
      "symbolic-ref --set refs/heads/x HEAD",
      ["symbolic-ref", "--set", "refs/heads/x", "HEAD"],
    ],
  ];

  for (const [label, args] of rejectedSymbolicRefs) {
    test(`rejects ${label}`, async () => {
      const repo = fixture();
      repo.write("a.txt", "a\n");
      repo.commit("initial");
      const git = await GitGateway.open(repo.root);

      const message = await rejectionMessage(git, args);
      expect(message).toContain("only reads symbolic refs");
    });
  }

  test("still allows the read form of symbolic-ref", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("initial");
    const git = await GitGateway.open(repo.root);

    const short = await git.text(["symbolic-ref", "--short", "HEAD"]);
    expect(short.trim()).toBe("main");
    expect((await git.text(["symbolic-ref", "--quiet", "HEAD"])).trim()).toBe(
      "refs/heads/main",
    );
    const quiet = await git.run(["symbolic-ref", "-q", "HEAD"], {
      allowExitCodes: [0, 1],
    });
    expect(quiet.exitCode).toBe(0);
    expect(await git.currentBranch()).toBe("main");
  });

  test("allows read-only ls-tree without opening the write-tree family", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("initial");
    const git = await GitGateway.open(repo.root);

    const output = await git.text(["ls-tree", "-z", "HEAD"]);
    expect(output).toContain("a.txt");

    for (const subcommand of ["write-tree", "mktree", "read-tree"]) {
      const message = await rejectionMessage(git, [subcommand]);
      expect(message).toContain("refuses to run non-read-only git command");
    }
  });

  test("allows callers that already pass --no-ext-diff", async () => {
    const repo = fixture();
    repo.write("a.txt", "one\n");
    repo.commit("initial");
    repo.write("a.txt", "one\ntwo\n");
    const git = await GitGateway.open(repo.root);

    const diff = await git.text([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
    ]);
    expect(diff).toContain("+two");
  });

  test("refuses --no-index inside the Repository", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("initial");
    const git = await GitGateway.open(repo.root);

    let message = "";
    try {
      await git.diffNoIndex(repo.root, "a.txt", "a.txt");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("inside the Repository");
  });

  test("diffs two files in a temporary directory with --no-index", async () => {
    const repo = fixture();
    repo.write("a.txt", "a\n");
    repo.commit("initial");
    const git = await GitGateway.open(repo.root);

    const directory = tempDirectory();
    mkdirSync(join(directory, "old"), { recursive: true });
    mkdirSync(join(directory, "new"), { recursive: true });
    writeFileSync(join(directory, "old", "a.txt"), "alpha\n");
    writeFileSync(join(directory, "new", "a.txt"), "beta\n");

    const result = await git.diffNoIndex(
      directory,
      join("old", "a.txt"),
      join("new", "a.txt"),
    );
    const output = result.stdout.toString("utf8");
    expect(result.exitCode).toBe(1);
    expect(output).toContain("-alpha");
    expect(output).toContain("+beta");
  });
});

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return typescriptFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("git spawn choke point", () => {
  test("only src/git/gateway.ts runs git", () => {
    const offenders: string[] = [];
    for (const file of typescriptFiles(SRC)) {
      if (file === GATEWAY) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (
        /\brunGit\b/.test(source) ||
        /cmd:\s*\[[^\]]*["'`]git["'`]/.test(source)
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
    expect(readFileSync(GATEWAY, "utf8")).toContain("Bun.spawn");
  });
});
