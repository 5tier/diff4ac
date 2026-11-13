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
  readonly addAll?: boolean;
  readonly trailers?: readonly string[];
}

export interface WriteOptions {
  readonly stage?: boolean;
}

const BASE_DATE = Date.UTC(2024, 0, 1, 12, 0, 0);

function dateAt(index: number): string {
  return new Date(BASE_DATE + index * 60_000).toISOString();
}

export interface FixtureRepo {
  readonly root: string;
  write(path: string, content: string, options?: WriteOptions): void;
  append(path: string, content: string): void;
  remove(path: string, options?: WriteOptions): void;
  rename(oldPath: string, newPath: string, options?: WriteOptions): void;
  stage(...paths: string[]): void;
  unstage(...paths: string[]): void;
  commit(message: string, options?: CommitOptions): string;
  git(args: readonly string[]): string;
  dispose(): void;
}

export function createFixtureRepo(): FixtureRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diff4ac-fixture-")));
  let commitIndex = 0;

  const git = (args: readonly string[], env: Record<string, string> = {}): string => {
    const proc = Bun.spawnSync({
      cmd: ["git", "--no-optional-locks", ...args],
      cwd: root,
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

  const absolute = (path: string) => join(root, path);

  const write = (path: string, content: string, options: WriteOptions = {}) => {
    mkdirSync(dirname(absolute(path)), { recursive: true });
    writeFileSync(absolute(path), content);
    if (options.stage) {
      git(["add", "--", path]);
    }
  };

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Fixture Author"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["config", "commit.gpgsign", "false"]);

  return {
    root,
    git,
    write,
    append(path, content) {
      const existing = readFileSync(absolute(path), "utf8");
      writeFileSync(absolute(path), `${existing}${content}`);
    },
    remove(path, options = {}) {
      unlinkSync(absolute(path));
      if (options.stage) {
        git(["add", "-A", "--", path]);
      }
    },
    rename(oldPath, newPath, options = {}) {
      mkdirSync(dirname(absolute(newPath)), { recursive: true });
      renameSync(absolute(oldPath), absolute(newPath));
      if (options.stage) {
        git(["add", "-A", "--", oldPath, newPath]);
      }
    },
    stage(...paths) {
      git(["add", "--", ...paths]);
    },
    unstage(...paths) {
      git(["reset", "-q", "HEAD", "--", ...paths]);
    },
    commit(message, options = {}) {
      commitIndex++;
      if (options.addAll ?? true) {
        git(["add", "-A"]);
      }

      const author: FixtureAuthor = options.author ?? {
        name: "Fixture Author",
        email: "fixture@example.com",
      };
      const date = options.date ?? dateAt(commitIndex);
      const trailers = options.trailers ?? [];
      const body = trailers.length
        ? `${message}\n\n${trailers.join("\n")}`
        : message;

      git(["commit", "-q", "-m", body], {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      });

      return git(["rev-parse", "HEAD"]).trim();
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
