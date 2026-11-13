import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureAuthor {
  readonly name: string;
  readonly email: string;
}

export interface CommitOptions {
  readonly author?: FixtureAuthor;
  readonly date?: string;
  readonly authorDate?: string;
  readonly committerDate?: string;
  readonly addAll?: boolean;
  readonly trailers?: readonly string[];
}

export interface WriteOptions {
  readonly stage?: boolean;
}

export interface WorktreeOptions {
  readonly branch?: string;
  readonly detach?: boolean;
  readonly startPoint?: string;
}

export interface FixtureCheckout {
  readonly root: string;
  write(path: string, content: string, options?: WriteOptions): void;
  append(path: string, content: string): void;
  remove(path: string, options?: WriteOptions): void;
  rename(oldPath: string, newPath: string, options?: WriteOptions): void;
  stage(...paths: string[]): void;
  unstage(...paths: string[]): void;
  commit(message: string, options?: CommitOptions): string;
  git(args: readonly string[]): string;
}

export interface FixtureRepo extends FixtureCheckout {
  addWorktree(name: string, options?: WorktreeOptions): FixtureCheckout;
  dispose(): void;
}

const BASE_DATE = Date.UTC(2024, 0, 1, 12, 0, 0);

function dateAt(index: number): string {
  return new Date(BASE_DATE + index * 60_000).toISOString();
}

export function createFixtureRepo(): FixtureRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diff4ac-fixture-")));
  let commitIndex = 0;
  let worktreesRoot: string | null = null;

  const gitIn = (
    cwd: string,
    args: readonly string[],
    env: Record<string, string> = {},
  ): string => {
    const proc = Bun.spawnSync({
      cmd: ["git", "--no-optional-locks", ...args],
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture Author",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "Fixture Author",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
        GIT_AUTHOR_DATE: dateAt(commitIndex),
        GIT_COMMITTER_DATE: dateAt(commitIndex),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        ...env,
      },
    });

    if (proc.exitCode !== 0) {
      throw new Error(
        `fixture git ${args.join(" ")} failed: ${proc.stderr.toString()}`,
      );
    }

    return proc.stdout.toString();
  };

  const createCheckout = (checkoutRoot: string): FixtureCheckout => {
    const absolute = (path: string) => join(checkoutRoot, path);

    const write = (
      path: string,
      content: string,
      options: WriteOptions = {},
    ) => {
      mkdirSync(dirname(absolute(path)), { recursive: true });
      writeFileSync(absolute(path), content);
      if (options.stage) {
        gitIn(checkoutRoot, ["add", "--", path]);
      }
    };

    return {
      root: checkoutRoot,
      git(args) {
        return gitIn(checkoutRoot, args);
      },
      write,
      append(path, content) {
        const existing = readFileSync(absolute(path), "utf8");
        writeFileSync(absolute(path), `${existing}${content}`);
      },
      remove(path, options = {}) {
        unlinkSync(absolute(path));
        if (options.stage) {
          gitIn(checkoutRoot, ["add", "-A", "--", path]);
        }
      },
      rename(oldPath, newPath, options = {}) {
        mkdirSync(dirname(absolute(newPath)), { recursive: true });
        renameSync(absolute(oldPath), absolute(newPath));
        if (options.stage) {
          gitIn(checkoutRoot, ["add", "-A", "--", oldPath, newPath]);
        }
      },
      stage(...paths) {
        gitIn(checkoutRoot, ["add", "--", ...paths]);
      },
      unstage(...paths) {
        gitIn(checkoutRoot, ["reset", "-q", "HEAD", "--", ...paths]);
      },
      commit(message, options = {}) {
        commitIndex++;
        if (options.addAll ?? true) {
          gitIn(checkoutRoot, ["add", "-A"]);
        }

        const author: FixtureAuthor = options.author ?? {
          name: "Fixture Author",
          email: "fixture@example.com",
        };
        const committerDate =
          options.committerDate ?? options.date ?? dateAt(commitIndex);
        const authorDate =
          options.authorDate ?? options.date ?? committerDate;
        const trailers = options.trailers ?? [];
        const body = trailers.length
          ? `${message}\n\n${trailers.join("\n")}`
          : message;

        gitIn(checkoutRoot, ["commit", "-q", "-m", body], {
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_COMMITTER_NAME: author.name,
          GIT_COMMITTER_EMAIL: author.email,
          GIT_AUTHOR_DATE: authorDate,
          GIT_COMMITTER_DATE: committerDate,
        });

        return gitIn(checkoutRoot, ["rev-parse", "HEAD"]).trim();
      },
    };
  };

  gitIn(root, ["init", "-q", "-b", "main"]);
  gitIn(root, ["config", "user.name", "Fixture Author"]);
  gitIn(root, ["config", "user.email", "fixture@example.com"]);
  gitIn(root, ["config", "commit.gpgsign", "false"]);

  const main = createCheckout(root);

  return {
    ...main,
    addWorktree(name, options = {}) {
      if (!worktreesRoot) {
        worktreesRoot = realpathSync(
          mkdtempSync(join(tmpdir(), "diff4ac-worktrees-")),
        );
      }

      const path = join(worktreesRoot, name);
      const args = ["worktree", "add", "-q"];

      if (options.branch) {
        args.push("-b", options.branch);
      } else if (options.detach) {
        args.push("--detach");
      }

      args.push(path);
      if (options.startPoint) {
        args.push(options.startPoint);
      }

      gitIn(root, args);
      return createCheckout(realpathSync(path));
    },
    dispose() {
      if (worktreesRoot) {
        rmSync(worktreesRoot, { recursive: true, force: true });
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
