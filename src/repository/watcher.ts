import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, relative as relativePath } from "node:path";
import { GitGateway } from "../git/gateway";
import { repositoryIdentity } from "./identity";
import { listWorktrees } from "./worktrees";

export interface RepositoryWatcherOptions {
  readonly onChanged: () => void;
  readonly debounceMs?: number;
}

type WatchedKind = "common" | "worktree";

function nulTokens(output: string): string[] {
  return output.split("\0").filter((token) => token !== "");
}

export class RepositoryWatcher {
  private readonly watchers: FSWatcher[] = [];
  private readonly observedPaths = new Map<string, WatchedKind>();
  private readonly worktreeGit = new Map<string, GitGateway>();
  private pendingCommon = false;
  private readonly pendingWorktrees = new Map<string, Set<string> | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  private constructor(
    private readonly git: GitGateway,
    private readonly onChanged: () => void,
    private readonly debounceMs: number,
  ) {}

  static async start(
    git: GitGateway,
    options: RepositoryWatcherOptions,
  ): Promise<RepositoryWatcher> {
    const watcher = new RepositoryWatcher(
      git,
      options.onChanged,
      options.debounceMs ?? 150,
    );

    const [commonDir, worktrees] = await Promise.all([
      repositoryIdentity(git),
      listWorktrees(git),
    ]);

    watcher.worktreeGit.set(git.worktreeRoot, git);
    watcher.observe(commonDir, "common");

    for (const worktree of worktrees.worktrees) {
      if (!watcher.worktreeGit.has(worktree.path)) {
        try {
          watcher.worktreeGit.set(
            worktree.path,
            worktree.path === git.worktreeRoot
              ? git
              : await GitGateway.open(worktree.path),
          );
        } catch {
          // The Worktree may disappear between listing and opening.
        }
      }
      watcher.observe(worktree.path, "worktree");
    }

    return watcher;
  }

  private observe(root: string, kind: WatchedKind): void {
    if (this.observedPaths.has(root)) {
      return;
    }
    this.observedPaths.set(root, kind);

    const onChange = (_event: string, filename: string | Buffer | null) => {
      if (kind === "common") {
        this.pendingCommon = true;
        this.schedule();
        return;
      }

      let changedPath: string | null = null;
      if (filename) {
        changedPath = filename.toString();
        if (isAbsolute(changedPath)) {
          changedPath = relativePath(root, changedPath);
        }
        changedPath = changedPath.replaceAll("\\", "/");
        while (changedPath.startsWith("./")) {
          changedPath = changedPath.slice(2);
        }

        if (
          changedPath === ".git" ||
          changedPath.startsWith(".git/")
        ) {
          return;
        }
      }

      this.recordWorktreeChange(root, changedPath);
      this.schedule();
    };

    try {
      const watcher = watch(root, { recursive: true }, onChange);
      watcher.on("error", () => {
        // Watchers can fail when a Worktree is removed; stop silently.
      });
      this.watchers.push(watcher);
    } catch {
      try {
        const watcher = watch(root, onChange);
        watcher.on("error", () => {});
        this.watchers.push(watcher);
      } catch {
        // A missing path simply has nothing to observe.
      }
    }
  }

  private recordWorktreeChange(root: string, path: string | null): void {
    if (this.pendingWorktrees.get(root) === null) {
      return;
    }

    if (!path) {
      this.pendingWorktrees.set(root, null);
      return;
    }

    const paths = this.pendingWorktrees.get(root) ?? new Set<string>();
    paths.add(path);
    this.pendingWorktrees.set(root, paths);
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async unignoredPaths(
    git: GitGateway,
    paths: readonly string[],
  ): Promise<readonly string[]> {
    if (paths.length === 0) {
      return [];
    }

    try {
      const result = await git.run(["check-ignore", "--stdin", "-z"], {
        input: `${paths.join("\0")}\0`,
        allowExitCodes: [0, 1],
      });
      if (result.exitCode !== 0) {
        return paths;
      }

      const ignored = new Set(nulTokens(result.stdout.toString("utf8")));
      return paths.filter((path) => !ignored.has(path));
    } catch {
      return paths;
    }
  }

  private async flush(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const changedCommon = this.pendingCommon;
    this.pendingCommon = false;

    const changedWorktrees = [...this.pendingWorktrees.entries()];
    this.pendingWorktrees.clear();

    let changed = changedCommon;

    if (!changed) {
      for (const [root, paths] of changedWorktrees) {
        if (paths === null) {
          changed = true;
          break;
        }
        if (paths.size === 0) {
          continue;
        }

        const worktreeGit = this.worktreeGit.get(root);
        if (!worktreeGit) {
          changed = true;
          break;
        }

        const remaining = await this.unignoredPaths(
          worktreeGit,
          [...paths],
        );
        if (remaining.length > 0) {
          changed = true;
          break;
        }
      }
    }

    if (!changed || this.stopped) {
      return;
    }

    this.onChanged();
    void this.refreshWorktreeWatchers();
  }

  private async refreshWorktreeWatchers(): Promise<void> {
    try {
      const worktrees = await listWorktrees(this.git);
      if (this.stopped) {
        return;
      }

      for (const worktree of worktrees.worktrees) {
        if (!this.worktreeGit.has(worktree.path)) {
          try {
            this.worktreeGit.set(
              worktree.path,
              worktree.path === this.git.worktreeRoot
                ? this.git
                : await GitGateway.open(worktree.path),
            );
          } catch {
            continue;
          }
        }
        this.observe(worktree.path, "worktree");
      }
    } catch {
      // A transient git failure should not break the watcher.
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const watcher of this.watchers.splice(0)) {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
    }
  }
}
