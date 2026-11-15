import { describe, expect, test } from "bun:test";
import { watch as fsWatch } from "node:fs";
import { GitGateway } from "../src/git/gateway";
import {
  RepositoryWatcher,
  type WatchFunction,
} from "../src/repository/watcher";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await Bun.sleep(20);
  }
}

function repoWithSource(): FixtureRepo {
  const repo = createFixtureRepo();
  repo.write(".gitignore", "node_modules/\n");
  repo.write("src/deep/a.ts", "one\n");
  repo.commit("initial");
  return repo;
}

async function start(
  repo: FixtureRepo,
  onChanged: () => void,
  options: {
    readonly watchStrategy?: "native" | "per-directory" | "polling";
    readonly watchFn?: WatchFunction;
    readonly pollIntervalMs?: number;
  } = {},
): Promise<RepositoryWatcher> {
  const git = await GitGateway.open(repo.root);
  return RepositoryWatcher.start(git, {
    onChanged,
    debounceMs: 20,
    ...(options.watchStrategy ? { watchStrategy: options.watchStrategy } : {}),
    ...(options.watchFn ? { watchFn: options.watchFn } : {}),
    ...(options.pollIntervalMs !== undefined
      ? { pollIntervalMs: options.pollIntervalMs }
      : {}),
  });
}

interface FakeHandle {
  readonly path: string;
  readonly recursive: boolean;
  readonly listener: (
    event: string,
    filename: string | Buffer | null,
  ) => void;
  errorListener: ((error: Error) => void) | null;
  closed: boolean;
}

function fakeWatch(handles: FakeHandle[]): WatchFunction {
  return (path, options, listener) => {
    const handle: FakeHandle = {
      path,
      recursive: options.recursive === true,
      listener,
      errorListener: null,
      closed: false,
    };
    handles.push(handle);
    return {
      on(event, errorListener) {
        if (event === "error") {
          handle.errorListener = errorListener;
        }
      },
      close() {
        handle.closed = true;
      },
    };
  };
}

describe("RepositoryWatcher", () => {
  test("ignores edits under ignored directories but sees nested source edits", async () => {
    const repo = repoWithSource();
    repo.write("node_modules/x.js", "one\n");
    const changes = { count: 0 };
    const watcher = await start(repo, () => {
      changes.count += 1;
    });

    try {
      repo.write("node_modules/x.js", "two\n");
      await Bun.sleep(300);
      expect(changes.count).toBe(0);

      repo.write("src/deep/a.ts", "two\n");
      await waitFor(() => changes.count > 0, "a nested source edit");
    } finally {
      watcher.stop();
      repo.dispose();
    }
  });

  test("falls back to per-directory when recursive watching is unavailable", async () => {
    const repo = repoWithSource();
    const changes = { count: 0 };
    const noRecursive: WatchFunction = (path, options, listener) => {
      if (options.recursive) {
        throw new Error("recursive watching is unsupported");
      }
      return fsWatch(path, options, listener);
    };
    const watcher = await start(
      repo,
      () => {
        changes.count += 1;
      },
      { watchStrategy: "per-directory", watchFn: noRecursive },
    );

    try {
      expect(watcher.status()[0]?.mode).toBe("per-directory");
      await Bun.sleep(100);
      repo.write("src/deep/fallback.ts", "one\n");
      await waitFor(
        () => changes.count > 0,
        "an edit with the non-recursive fallback",
      );
    } finally {
      watcher.stop();
      repo.dispose();
    }
  });

  test("per-directory mode watches a newly created nested directory", async () => {
    const repo = repoWithSource();
    const changes = { count: 0 };
    const watcher = await start(
      repo,
      () => {
        changes.count += 1;
      },
      { watchStrategy: "per-directory" },
    );

    try {
      expect(watcher.status()[0]?.mode).toBe("per-directory");

      const created = changes.count;
      repo.write("src/deep/new/b.ts", "one\n");
      await waitFor(
        () => changes.count > created,
        "the new directory to be watched",
      );

      const edited = changes.count;
      repo.write("src/deep/new/b.ts", "two\n");
      await waitFor(
        () => changes.count > edited,
        "an edit inside the new directory",
      );
    } finally {
      watcher.stop();
      repo.dispose();
    }
  });

  test("falls back to polling when watchers cannot be created", async () => {
    const repo = repoWithSource();
    const changes = { count: 0 };
    const failingWatch: WatchFunction = () => {
      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    };
    const watcher = await start(
      repo,
      () => {
        changes.count += 1;
      },
      { watchFn: failingWatch, pollIntervalMs: 100 },
    );

    try {
      const status = watcher.status().find((entry) => entry.path === repo.root);
      expect(status?.mode).toBe("polling");
      expect(status?.reason).toContain("ENOSPC");

      repo.write("src/deep/b.ts", "new\n");
      await waitFor(() => changes.count >= 1, "a nested edit while polling");

      const afterEdit = changes.count;
      repo.commit("a new commit");
      await waitFor(
        () => changes.count > afterEdit,
        "a new commit while polling",
      );
    } finally {
      watcher.stop();
      repo.dispose();
    }
  });

  test("switches to polling after a runtime watcher error", async () => {
    const repo = repoWithSource();
    const changes = { count: 0 };
    const handles: FakeHandle[] = [];
    const watcher = await start(
      repo,
      () => {
        changes.count += 1;
      },
      {
        watchStrategy: "native",
        watchFn: fakeWatch(handles),
        pollIntervalMs: 100,
      },
    );

    try {
      expect(
        watcher.status().find((entry) => entry.path === repo.root)?.mode,
      ).toBe("native");

      const worktreeHandle = handles.find(
        (handle) => handle.path === repo.root && handle.recursive,
      );
      expect(worktreeHandle).toBeDefined();
      worktreeHandle?.errorListener?.(new Error("boom"));

      await waitFor(
        () =>
          watcher.status().find((entry) => entry.path === repo.root)?.mode ===
          "polling",
        "the watcher to switch to polling",
      );
      expect(
        watcher
          .status()
          .find((entry) => entry.path === repo.root)
          ?.reason,
      ).toContain("boom");

      repo.write("src/deep/c.ts", "after error\n");
      await waitFor(
        () => changes.count >= 1,
        "a nested edit after the runtime error",
      );
    } finally {
      watcher.stop();
      repo.dispose();
    }
  });

  test("stop closes watchers and stops polling", async () => {
    const repo = repoWithSource();
    const handles: FakeHandle[] = [];
    const native = await start(
      repo,
      () => {},
      { watchStrategy: "native", watchFn: fakeWatch(handles) },
    );
    native.stop();
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.every((handle) => handle.closed)).toBe(true);
    repo.dispose();

    const pollRepo = repoWithSource();
    const changes = { count: 0 };
    const failingWatch: WatchFunction = () => {
      throw new Error("ENOSPC");
    };
    const polling = await start(
      pollRepo,
      () => {
        changes.count += 1;
      },
      { watchFn: failingWatch, pollIntervalMs: 50 },
    );
    polling.stop();
    pollRepo.write("src/deep/stopped.ts", "ignored after stop\n");
    await Bun.sleep(250);
    expect(changes.count).toBe(0);
    pollRepo.dispose();
  });
});
