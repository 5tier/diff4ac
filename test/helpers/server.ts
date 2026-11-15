import {
  startServer,
  type RunningServer,
} from "../../src/server/server";
import type {
  WatchFunction,
  WatchStrategy,
} from "../../src/repository/watcher";
import { createFixtureRepo, type FixtureRepo } from "./fixture";
import { createTempDirectory, registerCleanup } from "./cleanup";
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
  readonly commitPageSize?: number;
  readonly watchStrategy?: WatchStrategy;
  readonly watchFn?: WatchFunction;
  readonly watchPollIntervalMs?: number;
}

const active: FixtureServer[] = [];
const originalRepoDispose = new WeakMap<FixtureRepo, () => void>();

/**
 * Stop a fixture before its Repository is removed: fs.watch callbacks firing
 * on a deleted worktree can crash the Bun process.
 */
function cleanupFixture(fixture: FixtureServer): void {
  const index = active.indexOf(fixture);
  if (index !== -1) {
    active.splice(index, 1);
  }
  try {
    fixture.running.stop();
  } catch {
    // A test may already have stopped this server.
  }
  fixture.home.dispose();
  originalRepoDispose.get(fixture.repo)?.();
}

/** A temp directory removed automatically after the current test file. */
export function tempDirectory(prefix: string): string {
  return createTempDirectory(prefix);
}

/**
 * Start a server on a fixture Repository with a temp HOME and state directory.
 * Every fixture, HOME and directory created here is torn down automatically.
 */
export async function startFixtureServer(
  options: StartFixtureServerOptions = {},
): Promise<FixtureServer> {
  const repo = options.repo ?? createFixtureRepo();
  if (!originalRepoDispose.has(repo)) {
    const dispose = repo.dispose.bind(repo);
    originalRepoDispose.set(repo, dispose);
    // Test files often dispose their Repository in their own afterEach, which
    // Bun runs before hooks registered by this helper. Stop the server first.
    repo.dispose = () => {
      for (const fixture of [...active]) {
        if (fixture.repo === repo) {
          cleanupFixture(fixture);
        }
      }
      dispose();
    };
  }

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
    ...(options.commitPageSize !== undefined
      ? { commitPageSize: options.commitPageSize }
      : {}),
    ...(options.watchStrategy ? { watchStrategy: options.watchStrategy } : {}),
    ...(options.watchFn ? { watchFn: options.watchFn } : {}),
    ...(options.watchPollIntervalMs !== undefined
      ? { watchPollIntervalMs: options.watchPollIntervalMs }
      : {}),
  });

  const fixture = { repo, home, stateDir, running };
  active.push(fixture);
  registerCleanup(() => cleanupFixture(fixture));
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
