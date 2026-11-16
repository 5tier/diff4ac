#!/usr/bin/env bun
import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { parseArgs, UsageError, USAGE } from "./args";
import { GitGateway, NotAGitRepositoryError } from "./git/gateway";
import { startServer } from "./server/server";
import { VERSION } from "./version";

// Overridable so tests can simulate an installed diff4ac rooted elsewhere.
const PROJECT_ROOT =
  process.env.DIFF4AC_PROJECT_ROOT?.trim() || join(import.meta.dir, "..");
const WEB_INDEX = join(PROJECT_ROOT, "dist", "web", "index.html");

function isInside(path: string, root: string): boolean {
  const resolvedPath = realpathSync(path);
  const resolvedRoot = realpathSync(root);
  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

function installFolderWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureWebBuilt(git: GitGateway): Promise<boolean> {
  if (existsSync(WEB_INDEX)) {
    return true;
  }

  // Building writes into PROJECT_ROOT. If that is the Repository being
  // reviewed (diff4ac run from its own checkout), refuse instead.
  if (isInside(PROJECT_ROOT, git.worktreeRoot)) {
    console.error(
      `diff4ac: the SPA is not built; run "bun run build" in ${PROJECT_ROOT} first`,
    );
    return false;
  }

  if (!installFolderWritable(PROJECT_ROOT)) {
    console.error(
      `diff4ac: cannot build the web UI in ${PROJECT_ROOT}: the install folder is not writable. Reinstall diff4ac into a writable folder, or run the first build as the folder's owner, then try again.`,
    );
    return false;
  }

  console.error("diff4ac: building the SPA for first use…");
  const proc = Bun.spawn({
    cmd: [process.execPath, join(PROJECT_ROOT, "scripts", "build-web.ts")],
    cwd: PROJECT_ROOT,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await proc.exited) !== 0) {
    console.error("diff4ac: failed to build the SPA");
    return false;
  }

  return true;
}

function openBrowser(url: string): void {
  const commands: string[][] =
    process.platform === "darwin"
      ? [["open", url]]
      : process.platform === "win32"
        ? [["cmd", "/c", "start", "", url]]
        : [["xdg-open", url]];

  for (const cmd of commands) {
    try {
      Bun.spawn({
        cmd,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      return;
    } catch {
      // Try the next opener.
    }
  }

  console.error("diff4ac: could not open the browser; use the URL above");
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

async function main(): Promise<number> {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`diff4ac: ${error.message}`);
      console.error("");
      console.error(USAGE);
      return 2;
    }
    throw error;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  if (options.version) {
    console.log(VERSION);
    return 0;
  }

  let git: GitGateway;
  try {
    git = await GitGateway.open(options.path);
  } catch (error) {
    if (error instanceof NotAGitRepositoryError) {
      console.error(`diff4ac: ${error.message}`);
      console.error("diff4ac: run it inside a git Repository or pass a path inside one.");
      return 1;
    }
    throw error;
  }

  if (!(await ensureWebBuilt(git))) {
    return 1;
  }

  let running;
  try {
    running = await startServer({
      repoPath: git.worktreeRoot,
      port: options.port,
    });
  } catch (error) {
    console.error(
      `diff4ac: could not start the server: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }

  for (const diagnostic of running.config.diagnostics) {
    console.error(
      `diff4ac: config ${diagnostic.file}: ${diagnostic.field}: ${diagnostic.message} (using defaults)`,
    );
  }

  const branch = await git.currentBranch();
  console.log(`diff4ac ${VERSION}`);
  console.log(`Repository: ${git.worktreeRoot}`);
  console.log(`Worktree:   ${branch}`);
  console.log(`Listening:  ${running.url}`);
  console.log("Press Ctrl+C to stop.");

  if (options.open) {
    openBrowser(running.url);
  }

  await waitForShutdown();
  running.stop();
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(
      `diff4ac: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
