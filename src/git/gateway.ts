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
  /** Kill the subprocess after this long. Defaults to 30 s. */
  readonly timeoutMs?: number;
  /**
   * Empty stdout from a successful command is legitimate. Without this, an
   * exit-0 empty result is retried once and then fails with
   * EmptyGitOutputError.
   */
  readonly emptyOk?: boolean;
}

export const GIT_TIMEOUT_MS = 8_000;
export const GIT_HEAVY_TIMEOUT_MS = 30_000;
/** After git exits, how long to wait for Bun to deliver the stream EOFs. */
const GIT_EOF_GRACE_MS = 300;
const DEFAULT_GIT_TIMEOUT_MS = GIT_TIMEOUT_MS;
const MAX_CONCURRENT_GIT = 32;
let activeGitProcesses = 0;
const gitWaiters: Array<() => void> = [];

async function acquireGitSlot(): Promise<void> {
  if (activeGitProcesses < MAX_CONCURRENT_GIT) {
    activeGitProcesses++;
    return;
  }
  await new Promise<void>((resolve) => gitWaiters.push(resolve));
}

function releaseGitSlot(): void {
  const next = gitWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeGitProcesses--;
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

export interface GitTimeoutDiagnostics {
  readonly pid: number | null;
  readonly exitCode: number | null;
  readonly signalCode: string | number | null;
  readonly killed: boolean;
  readonly exitedResolved: boolean;
  readonly stdoutEof: boolean;
  readonly stderrEof: boolean;
  readonly processAlive: boolean;
  readonly elapsedMs: number;
}

export class GitTimeoutError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly timeoutMs: number,
    readonly diagnostics?: GitTimeoutDiagnostics,
  ) {
    super(`git ${args.join(" ")} timed out after ${timeoutMs} ms`);
    this.name = "GitTimeoutError";
  }
}

class GitLostOutputError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly diagnostics: GitTimeoutDiagnostics,
  ) {
    super(
      `git ${args.join(" ")} exited but its output pipes never closed`,
    );
    this.name = "GitLostOutputError";
  }
}

export class EmptyGitOutputError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(
      `git ${args.join(" ")} produced no output on success${
        stderr.trim() ? `: ${stderr.trim()}` : ""
      }`,
    );
    this.name = "EmptyGitOutputError";
  }
}

class GitReadError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly cause: unknown,
  ) {
    super(
      `could not read git ${args.join(" ")} output: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "GitReadError";
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
  "ls-tree",
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

function diagnosticsFor(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null,
  startedAt: number,
  exitedResolved: boolean,
  stdoutEof: boolean,
  stderrEof: boolean,
): GitTimeoutDiagnostics {
  const pid = proc?.pid ?? null;
  let processAlive = false;
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      processAlive = true;
    } catch {
      processAlive = false;
    }
  }
  return {
    pid,
    exitCode: proc?.exitCode ?? null,
    signalCode: proc?.signalCode ?? null,
    killed: proc?.killed ?? false,
    exitedResolved,
    stdoutEof,
    stderrEof,
    processAlive,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function runGitOnce(
  args: readonly string[],
  options: GitRunOptions,
  readOnly: ReadOnlyOptions = {},
): Promise<GitResult> {
  assertReadOnly(args, readOnly);
  const safeArgs = withDiffSafetyFlags(args);

  const allowExitCodes = options.allowExitCodes ?? [0];
  spawnObserver?.(safeArgs);
  await acquireGitSlot();
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
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

    try {
      if (options.input !== undefined) {
        proc.stdin.write(options.input);
      }
      await proc.stdin.end();
    } catch (error) {
      throw new GitReadError(safeArgs, error);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
    const startedAt = performance.now();
    let stdoutEof = false;
    let stderrEof = false;
    let exitedResolved = false;
    // Bun can lose the stream objects themselves under load; treat that like
    // any other pipe loss so the call is retried instead of crashing.
    if (!proc.stdout || !proc.stderr) {
      throw new GitReadError(
        safeArgs,
        new Error("git subprocess is missing its output pipes"),
      );
    }

    const stdoutPromise = new Response(proc.stdout)
      .arrayBuffer()
      .then((buffer) => {
        stdoutEof = true;
        return buffer;
      });

    // Read stderr by hand so a pipe held open after git exits can still return
    // the bytes git already wrote.
    const stderrChunks: Uint8Array[] = [];
    let stderrForced = false;
    let resolveStderr!: () => void;
    let rejectStderr!: (error: unknown) => void;
    const stderrDone = new Promise<void>((resolve, reject) => {
      resolveStderr = resolve;
      rejectStderr = reject;
    });
    const stderrReader = proc.stderr.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await stderrReader.read();
          if (done) {
            break;
          }
          if (value) {
            stderrChunks.push(value);
          }
        }
        if (!stderrForced) {
          stderrEof = true;
        }
        resolveStderr();
      } catch (error) {
        if (stderrForced) {
          resolveStderr();
          return;
        }
        rejectStderr(error);
      }
    })();
    const stderrText = (): string =>
      Buffer.concat(stderrChunks).toString("utf8");
    const forceStderr = (): void => {
      if (stderrForced) {
        return;
      }
      stderrForced = true;
      stderrEof = true;
      resolveStderr();
      void stderrReader.cancel().catch(() => {});
    };

    const readers = Promise.all([
      stdoutPromise,
      stderrDone,
      proc.exited.then((code) => {
        exitedResolved = true;
        return code;
      }),
    ]);
    // If this promise loses the race after another one rejected, its later
    // rejection must not surface as unhandled.
    readers.catch(() => {});

    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const lostOutput = new Promise<never>((_resolve, reject) => {
      void proc?.exited.then(() => {
        exitedResolved = true;
        if (settled || (stdoutEof && stderrEof)) {
          return;
        }
        graceTimer = setTimeout(() => {
          if (settled) {
            return;
          }
          if (!stdoutEof) {
            const diagnostics = diagnosticsFor(
              proc,
              startedAt,
              exitedResolved,
              stdoutEof,
              stderrEof,
            );
            console.error(
              `diff4ac: git lost output ${safeArgs.join(" ")}`,
              JSON.stringify(diagnostics),
            );
            reject(new GitLostOutputError(safeArgs, diagnostics));
            return;
          }
          if (!stderrEof) {
            console.error(`diff4ac: git lost stderr ${safeArgs.join(" ")}`);
            forceStderr();
          }
        }, GIT_EOF_GRACE_MS);
      });
    });
    // A lost pipe loses the race when the timeout or a reader fails first;
    // its later rejection must not surface as unhandled.
    lostOutput.catch(() => {});

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const pid = proc?.pid ?? null;
        const diagnostics = diagnosticsFor(
          proc,
          startedAt,
          exitedResolved,
          stdoutEof,
          stderrEof,
        );
        let ps = "";
        if (pid !== null) {
          try {
            ps = Bun.spawnSync({
              cmd: ["ps", "-o", "stat=,command=", "-p", String(pid)],
              stdin: "ignore",
              stdout: "pipe",
              stderr: "ignore",
            }).stdout.toString("utf8").trim();
          } catch {
            // ps is diagnostic only.
          }
        }
        console.error(
          `diff4ac: git timeout ${safeArgs.join(" ")}`,
          JSON.stringify(diagnostics),
          ps ? `ps=${ps}` : "",
        );
        try {
          proc?.kill();
        } catch {
          // Already gone.
        }
        reject(new GitTimeoutError(safeArgs, timeoutMs, diagnostics));
      }, timeoutMs);
    });

    let stdoutBuffer: ArrayBuffer;
    let stderr: string;
    let exitCode: number;
    try {
      [stdoutBuffer, , exitCode] = await Promise.race([
        readers,
        timeout,
        lostOutput,
      ]);
      stderr = stderrText();
    } catch (error) {
      if (error instanceof GitTimeoutError) {
        throw error;
      }
      if (error instanceof GitLostOutputError) {
        throw error;
      }
      throw new GitReadError(safeArgs, error);
    } finally {
      settled = true;
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    }

    if (!allowExitCodes.includes(exitCode)) {
      throw new GitError(safeArgs, exitCode, stderr);
    }

    return {
      stdout: Buffer.from(stdoutBuffer),
      stderr,
      exitCode,
    };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (proc && proc.exitCode === null) {
      try {
        proc.kill();
      } catch {
        // Already gone.
      }
    }
    releaseGitSlot();
  }
}

/** Cheap Bun-pipe flukes get two retries; timeouts keep their tighter budget. */
const TRANSIENT_RETRIES = 2;

function shouldRetryGit(error: unknown, attempt: number): boolean {
  // Bun 1.4.0-canary.1 occasionally loses a subprocess pipe under load
  // (`EBADF: bad file descriptor, recv`) and git can exit 141 (SIGPIPE).
  // These cheap failures get two retries because two lost pipes in a row
  // have been observed. Short read-only calls time out once; heavy log/diff
  // calls opt into the long timeout and are not retried.
  if (
    error instanceof GitReadError ||
    error instanceof GitLostOutputError ||
    (error instanceof GitError && error.exitCode === 141)
  ) {
    return attempt < TRANSIENT_RETRIES;
  }
  if (error instanceof GitTimeoutError) {
    return error.timeoutMs <= GIT_TIMEOUT_MS && attempt < 1;
  }
  return false;
}

async function runGit(
  args: readonly string[],
  options: GitRunOptions,
  readOnly: ReadOnlyOptions = {},
): Promise<GitResult> {
  const safeArgs = withDiffSafetyFlags(args);

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await runGitOnce(args, options, readOnly);
      if (
        !options.emptyOk &&
        result.exitCode === 0 &&
        result.stdout.length === 0
      ) {
        if (attempt < TRANSIENT_RETRIES) {
          console.error(
            `diff4ac: retrying empty git output: git ${safeArgs.join(" ")}`,
          );
          continue;
        }
        throw new EmptyGitOutputError(safeArgs, result.stderr);
      }
      return result;
    } catch (error) {
      if (shouldRetryGit(error, attempt)) {
        console.error(
          `diff4ac: retrying git after ${
            error instanceof Error ? error.name : String(error)
          }: git ${safeArgs.join(" ")}`,
        );
        continue;
      }
      throw error;
    }
  }
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
      const { stdout } = await runGit(["rev-parse", "--show-toplevel"], {
        cwd,
      });
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
      {
        cwd: directory,
        allowExitCodes: [0, 1],
        timeoutMs: GIT_HEAVY_TIMEOUT_MS,
        emptyOk: true,
      },
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
      {
        cwd: this.worktreeRoot,
        allowExitCodes: [0, 1],
        timeoutMs: GIT_HEAVY_TIMEOUT_MS,
        emptyOk: true,
      },
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
    return result.stdout.toString("utf8").trim();
  }
}
