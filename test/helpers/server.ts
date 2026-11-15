import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startServer,
  type RunningServer,
} from "../../src/server/server";
import { createFixtureRepo, type FixtureRepo } from "./fixture";
import { createTempHome, type TempHome } from "./home";

export interface FixtureServer {
  readonly repo: FixtureRepo;
  readonly home: TempHome;
  readonly stateDir: string;
  readonly running: RunningServer;
}

export interface StartFixtureServerOptions {
  /** A Repository the caller already prepared; it is disposed after the test. */
  readonly repo?: FixtureRepo;
  readonly webDir?: string;
  readonly stateDir?: string;
  readonly watchDebounceMs?: number;
}

const active: FixtureServer[] = [];
const ownedDirectories: string[] = [];

/** A temp directory removed automatically after the current test file. */
export function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  ownedDirectories.push(directory);
  return directory;
}

/**
 * Start a server on a fixture Repository with a temp HOME and state directory.
 * Every fixture, HOME and directory created here is torn down automatically.
 */
export async function startFixtureServer(
  options: StartFixtureServerOptions = {},
): Promise<FixtureServer> {
  const repo = options.repo ?? createFixtureRepo();
  const home = createTempHome();
  const stateDir = options.stateDir ?? tempDirectory("diff4ac-state-");

  const running = await startServer({
    repoPath: repo.root,
    homeDir: home.path,
    stateDir,
    ...(options.webDir ? { webDir: options.webDir } : {}),
    ...(options.watchDebounceMs !== undefined
      ? { watchDebounceMs: options.watchDebounceMs }
      : {}),
  });

  const fixture = { repo, home, stateDir, running };
  active.push(fixture);
  return fixture;
}

export async function getJson<T>(
  running: RunningServer,
  path: string,
): Promise<{ readonly status: number; readonly body: T }> {
  const response = await getRaw(running, path);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T };
}

export function getRaw(running: RunningServer, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${running.port}${path}`, {
    headers: { "x-diff4ac-token": running.token },
  });
}

afterEach(() => {
  for (const fixture of active.splice(0)) {
    try {
      fixture.running.stop();
    } catch {
      // A test may already have stopped this server.
    }
    fixture.repo.dispose();
    fixture.home.dispose();
  }
  for (const directory of ownedDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
