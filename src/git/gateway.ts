import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

export interface GitResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface GitRunOptions {
  readonly cwd: string;
  readonly allowExitCodes?: readonly number[];
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed with exit code ${exitCode}: ${stderr.trim()}`);
    this.name = "GitError";
  }
}

export class NotAGitRepositoryError extends Error {
  constructor(path: string) {
    super(`"${path}" is not inside a git Repository`);
    this.name = "NotAGitRepositoryError";
  }
}

const READ_ONLY_SUBCOMMANDS = new Set([
  "cat-file",
  "diff",
  "for-each-ref",
  "log",
  "ls-files",
  "merge-base",
  "rev-list",
  "rev-parse",
  "show",
  "status",
  "symbolic-ref",
  "worktree",
]);

function assertReadOnly(args: readonly string[]): void {
  const [subcommand, ...rest] = args;
  if (!subcommand || !READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`diff4ac refuses to run non-read-only git command: ${args.join(" ")}`);
  }

  if (subcommand === "worktree" && rest[0] !== "list") {
    throw new Error(`diff4ac only runs the read-only "git worktree list" form`);
  }

  if (subcommand === "symbolic-ref") {
    const writes = rest.some(
      (arg) => arg === "-m" || arg.startsWith("--set") || arg.startsWith("--delete"),
    );
    if (writes) {
      throw new Error(`diff4ac only reads symbolic refs`);
    }
  }
}

export async function runGit(
  args: readonly string[],
  options: GitRunOptions,
): Promise<GitResult> {
  assertReadOnly(args);

  const allowExitCodes = options.allowExitCodes ?? [0];
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn({
      cmd: ["git", "--no-optional-locks", ...args],
      cwd: options.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
    });
  } catch (error) {
    throw new Error(
      `could not run git: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const [stdoutBuffer, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (!allowExitCodes.includes(exitCode)) {
    throw new GitError(args, exitCode, stderr);
  }

  return {
    stdout: Buffer.from(stdoutBuffer),
    stderr,
    exitCode,
  };
}

function directoryFor(path: string): string {
  const stat = statSync(path);
  return stat.isDirectory() ? path : dirname(path);
}

export class GitGateway {
  private constructor(readonly worktreeRoot: string) {}

  static async open(path: string): Promise<GitGateway> {
    if (!existsSync(path)) {
      throw new NotAGitRepositoryError(path);
    }

    let cwd: string;
    try {
      cwd = directoryFor(path);
    } catch {
      throw new NotAGitRepositoryError(path);
    }

    try {
      const { stdout } = await runGit(["rev-parse", "--show-toplevel"], { cwd });
      const root = stdout.toString("utf8").trim();
      if (!root) {
        throw new NotAGitRepositoryError(path);
      }
      return new GitGateway(root);
    } catch (error) {
      if (error instanceof GitError) {
        throw new NotAGitRepositoryError(path);
      }
      throw error;
    }
  }

  run(
    args: readonly string[],
    options: Omit<GitRunOptions, "cwd"> = {},
  ): Promise<GitResult> {
    return runGit(args, { ...options, cwd: this.worktreeRoot });
  }

  async text(
    args: readonly string[],
    options: Omit<GitRunOptions, "cwd"> = {},
  ): Promise<string> {
    const { stdout } = await this.run(args, options);
    return stdout.toString("utf8");
  }

  async hasHead(): Promise<boolean> {
    const result = await this.run(["rev-parse", "--verify", "--quiet", "HEAD"], {
      allowExitCodes: [0, 1],
    });
    return result.exitCode === 0;
  }

  async currentBranch(): Promise<string> {
    const result = await this.run(["symbolic-ref", "--short", "-q", "HEAD"], {
      allowExitCodes: [0, 1],
    });
    if (result.exitCode !== 0) {
      return "HEAD";
    }
    return result.stdout.toString("utf8").trim() || "HEAD";
  }
}
