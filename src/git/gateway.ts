import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export interface GitResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface GitRunOptions {
  readonly cwd: string;
  readonly allowExitCodes?: readonly number[];
  readonly input?: string | Uint8Array;
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

export type GitSpawnObserver = (args: readonly string[]) => void;

let spawnObserver: GitSpawnObserver | null = null;

/**
 * Test-only hook, e.g. to count git processes. Production code must never
 * install one; pass null to remove it.
 */
export function setGitSpawnObserver(observer: GitSpawnObserver | null): void {
  spawnObserver = observer;
}

export class NotAGitRepositoryError extends Error {
  constructor(path: string) {
    super(`"${path}" is not inside a git Repository`);
    this.name = "NotAGitRepositoryError";
  }
}

const READ_ONLY_SUBCOMMANDS = new Set([
  "cat-file",
  "check-ignore",
  "config",
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

/**
 * Options that write to disk or execute a program configured by the
 * Repository. They are refused anywhere in the arguments, in both the
 * `--opt` and `--opt=value` forms. `--no-index` is only reachable through
 * `GitGateway.diffNoIndex` and `GitGateway.diffUntracked`.
 *
 * Git does not accept `--exec` or `--run` for diff, log or show (they fail
 * with "unknown option"/"unrecognized argument"), so they need no guard.
 */
const DISALLOWED_OPTIONS = [
  "--output",
  "--ext-diff",
  "--textconv",
  "--no-index",
] as const;

const CAT_FILE_DISALLOWED_OPTIONS = ["--filters"] as const;

const DIFF_FAMILY_SUBCOMMANDS = new Set(["diff", "log", "show"]);

/** Inserted right after the subcommand so callers cannot forget them. */
const DIFF_SAFETY_FLAGS = ["--no-ext-diff", "--no-textconv"] as const;

const SYMBOLIC_REF_READ_FLAGS = new Set(["-q", "--quiet", "--short"]);

interface ReadOnlyOptions {
  readonly allowNoIndex?: boolean;
}

function optionName(arg: string): string | null {
  if (!arg.startsWith("-")) {
    return null;
  }
  const equals = arg.indexOf("=");
  return equals === -1 ? arg : arg.slice(0, equals);
}

function optionsBeforePaths(args: readonly string[]): readonly string[] {
  const separator = args.indexOf("--");
  return separator === -1 ? args : args.slice(0, separator);
}

function rejectOption(subcommand: string, option: string): never {
  throw new Error(
    `diff4ac refuses to run git with the disallowed option "${option}": ${subcommand} ${option}`,
  );
}

function assertReadOnlyOptions(
  subcommand: string,
  rest: readonly string[],
  allowNoIndex: boolean,
): void {
  for (const arg of optionsBeforePaths(rest)) {
    const name = optionName(arg);
    if (!name) {
      continue;
    }
    if (name === "--no-index" && allowNoIndex) {
      continue;
    }
    if ((DISALLOWED_OPTIONS as readonly string[]).includes(name)) {
      rejectOption(subcommand, name);
    }
    if (
      subcommand === "cat-file" &&
      (CAT_FILE_DISALLOWED_OPTIONS as readonly string[]).includes(name)
    ) {
      rejectOption(subcommand, name);
    }
  }
}

function assertSymbolicRefReadForm(rest: readonly string[]): void {
  const refs: string[] = [];
  for (const arg of rest) {
    if (arg.startsWith("-")) {
      if (!SYMBOLIC_REF_READ_FLAGS.has(arg)) {
        throw new Error(
          `diff4ac only reads symbolic refs: symbolic-ref ${rest.join(" ")}`,
        );
      }
      continue;
    }
    refs.push(arg);
  }

  // `git symbolic-ref HEAD refs/heads/x` writes HEAD; `-d`, `--delete`, `-m`
  // and `--set*` write too. Only `<flag>* <one ref>` is a read.
  if (refs.length !== 1) {
    throw new Error(
      `diff4ac only reads symbolic refs: symbolic-ref ${rest.join(" ")}`,
    );
  }
}

function assertReadOnly(
  args: readonly string[],
  options: ReadOnlyOptions = {},
): void {
  const [subcommand, ...rest] = args;
  if (!subcommand || !READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`diff4ac refuses to run non-read-only git command: ${args.join(" ")}`);
  }

  assertReadOnlyOptions(subcommand, rest, options.allowNoIndex ?? false);

  if (subcommand === "config") {
    const readsFileMode =
      rest.length === 3 &&
      rest[0] === "--bool" &&
      rest[1] === "--get" &&
      rest[2] === "core.fileMode";
    if (!readsFileMode) {
      throw new Error(`diff4ac only reads core.fileMode from git config`);
    }
  }

  if (subcommand === "worktree" && rest[0] !== "list") {
    throw new Error(`diff4ac only runs the read-only "git worktree list" form`);
  }

  if (subcommand === "symbolic-ref") {
    assertSymbolicRefReadForm(rest);
  }
}

/**
 * Force `--no-ext-diff --no-textconv` on the diff family so an external diff
 * or textconv driver configured in the Repository can never run. Callers may
 * still pass the flags themselves; they are moved behind ours rather than
 * duplicated (git tolerates the repeat either way).
 */
function withDiffSafetyFlags(args: readonly string[]): readonly string[] {
  const [subcommand, ...rest] = args;
  if (!subcommand || !DIFF_FAMILY_SUBCOMMANDS.has(subcommand)) {
    return args;
  }

  const separator = rest.indexOf("--");
  const head = separator === -1 ? rest : rest.slice(0, separator);
  const tail = separator === -1 ? [] : rest.slice(separator);
  const filtered = head.filter(
    (arg) => arg !== "--no-ext-diff" && arg !== "--no-textconv",
  );
  return [subcommand, ...DIFF_SAFETY_FLAGS, ...filtered, ...tail];
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function assertInside(directory: string, relativePath: string): void {
  if (
    isAbsolute(relativePath) ||
    !isInside(resolve(directory, relativePath), directory)
  ) {
    throw new Error(
      `diff4ac refuses to diff a path outside the temporary directory: ${relativePath}`,
    );
  }
}

async function runGit(
  args: readonly string[],
  options: GitRunOptions,
  readOnly: ReadOnlyOptions = {},
): Promise<GitResult> {
  assertReadOnly(args, readOnly);
  const safeArgs = withDiffSafetyFlags(args);

  const allowExitCodes = options.allowExitCodes ?? [0];
  spawnObserver?.(safeArgs);
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn({
      cmd: ["git", "--no-optional-locks", ...safeArgs],
      cwd: options.cwd,
      stdin: "pipe",
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

  if (options.input !== undefined) {
    proc.stdin.write(options.input);
  }
  await proc.stdin.end();

  const [stdoutBuffer, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (!allowExitCodes.includes(exitCode)) {
    throw new GitError(safeArgs, exitCode, stderr);
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

  /**
   * `git diff --no-index` over two relative paths inside `dir`. Only the
   * paired-rename helper uses this: `dir` must be a throwaway directory
   * outside the Repository, and the method refuses one inside the worktree.
   */
  diffNoIndex(
    dir: string,
    oldRel: string,
    newRel: string,
    extraArgs: readonly string[] = [],
  ): Promise<GitResult> {
    const directory = realpathSync(dir);
    const root = realpathSync(this.worktreeRoot);
    if (isInside(directory, root)) {
      throw new Error(
        "diff4ac refuses to run git diff --no-index inside the Repository",
      );
    }
    assertInside(directory, oldRel);
    assertInside(directory, newRel);

    return runGit(
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        ...extraArgs,
        "--",
        oldRel,
        newRel,
      ],
      { cwd: directory, allowExitCodes: [0, 1] },
      { allowNoIndex: true },
    );
  }

  /**
   * The only in-Repository `--no-index` use: diff an untracked worktree file
   * against `/dev/null`. It reads the file and writes nothing.
   */
  diffUntracked(
    relativePath: string,
    extraArgs: readonly string[] = [],
  ): Promise<GitResult> {
    const root = realpathSync(this.worktreeRoot);
    assertInside(root, relativePath);

    return runGit(
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        ...extraArgs,
        "--",
        "/dev/null",
        relativePath,
      ],
      { cwd: this.worktreeRoot, allowExitCodes: [0, 1] },
      { allowNoIndex: true },
    );
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
