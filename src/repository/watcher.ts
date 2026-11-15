import {
  existsSync,
  readdirSync,
  statSync,
  watch,
} from "node:fs";
import { dirname, isAbsolute, join, relative as relativePath } from "node:path";
import {
  GIT_HEAVY_TIMEOUT_MS,
  GitGateway,
} from "../git/gateway";
import { repositoryIdentity } from "./identity";
import { listWorktrees } from "./worktrees";
import type { WatchMode, WatchStatus } from "../../shared/types";

export type WatchStrategy = "platform" | "native" | "per-directory" | "polling";

export interface WatchHandle {
  on(event: "error", listener: (error: Error) => void): void;
  close(): void;
}

export type WatchFunction = (
  path: string,
  options: { readonly recursive?: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => WatchHandle;

export interface RepositoryWatcherOptions {
  readonly onChanged: () => void;
  readonly debounceMs?: number;
  /** Test seam; production uses the platform default. */
  readonly watchStrategy?: WatchStrategy;
  /** Test seam for injecting watcher failures. */
  readonly watchFn?: WatchFunction;
  /** Test seam; production polls every {@link WATCH_POLL_INTERVAL_MS}. */
  readonly pollIntervalMs?: number;
}

/** How often a polling Worktree compares its fingerprint. */
export const WATCH_POLL_INTERVAL_MS = 3000;

/** Above this many per-directory watchers we switch the Worktree to polling. */
export const MAX_DIRECTORY_WATCHERS = 10_000;

type WatchedKind = "common" | "worktree";

const platformWatch: WatchFunction = (path, options, listener) =>
  watch(path, options, listener);

function nulTokens(output: string): string[] {
  return output.split("\0").filter((token) => token !== "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultStrategy(): Exclude<WatchStrategy, "platform"> {
  return process.platform === "linux" ? "per-directory" : "native";
}

export class RepositoryWatcher {
  private readonly watchers: WatchHandle[] = [];
  private readonly observedPaths = new Map<string, WatchedKind>();
  private readonly worktreeGit = new Map<string, GitGateway>();
  private readonly statusByWorktree = new Map<string, WatchStatus>();
  private readonly nativeWatchers = new Map<string, WatchHandle>();
  private readonly directoryWatchers = new Map<
    string,
    Map<string, WatchHandle>
  >();
  private readonly pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly pollingStarting = new Set<string>();
  private readonly pollingBusy = new Set<string>();
  private readonly pollFingerprints = new Map<string, string>();
  private readonly ignoredDirs = new Map<string, Set<string>>();
  private readonly checkedDirs = new Map<string, Set<string>>();
  private readonly watchFn: WatchFunction;
  private readonly watchStrategy: WatchStrategy;
  private readonly pollIntervalMs: number;
  private pendingCommon = false;
  private readonly pendingWorktrees = new Map<string, Set<string> | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private commonError: string | null = null;

  private constructor(
    private readonly git: GitGateway,
    private readonly onChanged: () => void,
    private readonly debounceMs: number,
    watchFn: WatchFunction,
    watchStrategy: WatchStrategy,
    pollIntervalMs: number,
  ) {
    this.watchFn = watchFn;
    this.watchStrategy = watchStrategy;
    this.pollIntervalMs = pollIntervalMs;
  }

  static async start(
    git: GitGateway,
    options: RepositoryWatcherOptions,
  ): Promise<RepositoryWatcher> {
    const watcher = new RepositoryWatcher(
      git,
      options.onChanged,
      options.debounceMs ?? 150,
      options.watchFn ?? platformWatch,
      options.watchStrategy ?? "platform",
      options.pollIntervalMs ?? WATCH_POLL_INTERVAL_MS,
    );

    const [commonDir, worktrees] = await Promise.all([
      repositoryIdentity(git),
      listWorktrees(git),
    ]);

    watcher.worktreeGit.set(git.worktreeRoot, git);
    watcher.observeCommon(commonDir);

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
      await watcher.setupWorktree(worktree.path);
    }

    return watcher;
  }

  /** Current watcher mode for each Worktree. */
  status(): readonly WatchStatus[] {
    return [...this.statusByWorktree.values()];
  }

  private observeCommon(root: string): void {
    if (this.observedPaths.has(root)) {
      return;
    }
    this.observedPaths.set(root, "common");

    const onChange = (_event: string, filename: string | Buffer | null) => {
      if (filename) {
        const changedPath = filename.toString();
        if (changedPath === ".git" || changedPath.startsWith(".git/")) {
          return;
        }
      }
      this.pendingCommon = true;
      this.schedule();
    };

    try {
      this.addCommonWatcher(this.watchFn(root, { recursive: true }, onChange));
    } catch (error) {
      try {
        this.addCommonWatcher(this.watchFn(root, {}, onChange));
      } catch (fallbackError) {
        this.commonError = errorMessage(fallbackError ?? error);
      }
    }
  }

  private addCommonWatcher(watcher: WatchHandle): void {
    watcher.on("error", (error) => {
      const reason = `common watcher error: ${errorMessage(error)}`;
      for (const worktreeRoot of this.worktreeGit.keys()) {
        this.switchToPolling(worktreeRoot, reason);
      }
    });
    this.watchers.push(watcher);
  }

  private async setupWorktree(root: string): Promise<void> {
    if (this.stopped || this.statusByWorktree.has(root)) {
      return;
    }

    if (this.commonError) {
      await this.startPolling(root, this.commonError);
      return;
    }

    const strategy =
      this.watchStrategy === "platform"
        ? defaultStrategy()
        : this.watchStrategy;

    if (strategy === "polling") {
      await this.startPolling(root, "watch strategy forced to polling");
      return;
    }

    if (strategy === "per-directory") {
      try {
        await this.setupPerDirectory(root);
        this.setStatus(root, "per-directory");
        return;
      } catch (error) {
        await this.startPolling(root, errorMessage(error));
        return;
      }
    }

    try {
      this.setupNative(root);
      this.setStatus(root, "native");
      return;
    } catch (error) {
      try {
        await this.setupPerDirectory(root);
        this.setStatus(root, "per-directory");
        return;
      } catch (fallbackError) {
        await this.startPolling(
          root,
          `${errorMessage(error)}; ${errorMessage(fallbackError)}`,
        );
      }
    }
  }

  private setStatus(
    root: string,
    mode: WatchMode,
    reason?: string,
  ): void {
    this.statusByWorktree.set(root, {
      path: root,
      mode,
      ...(reason ? { reason } : {}),
    });
  }

  private setupNative(root: string): void {
    this.observe(root, "worktree");
  }

  private observe(root: string, kind: WatchedKind): void {
    if (this.observedPaths.has(root)) {
      return;
    }
    this.observedPaths.set(root, kind);

    const watcher = this.watchFn(root, { recursive: true }, (event, filename) =>
      this.handleWorktreeEvent(root, event, filename),
    );
    watcher.on("error", (error) => {
      this.switchToPolling(root, `watcher error: ${errorMessage(error)}`);
    });
    this.watchers.push(watcher);
    this.nativeWatchers.set(root, watcher);
  }

  private async setupPerDirectory(root: string): Promise<void> {
    const git = this.worktreeGit.get(root);
    if (!git) {
      throw new Error(`no GitGateway for Worktree ${root}`);
    }

    const directories = await this.listWatchDirectories(root, git);
    if (directories.length > MAX_DIRECTORY_WATCHERS) {
      throw new Error(
        `${directories.length} directories exceed the ${MAX_DIRECTORY_WATCHERS}-watcher cap`,
      );
    }

    const created: string[] = [];
    try {
      for (const directory of directories) {
        this.watchDirectory(root, directory);
        created.push(directory);
      }
    } catch (error) {
      for (const directory of created) {
        this.closeDirectoryWatcher(root, directory);
      }
      throw error;
    }
  }

  private watchDirectory(root: string, directory: string): void {
    if (this.stopped) {
      return;
    }

    let watchers = this.directoryWatchers.get(root);
    if (!watchers) {
      watchers = new Map();
      this.directoryWatchers.set(root, watchers);
    }
    if (watchers.has(directory)) {
      return;
    }

    const absolute = directory ? join(root, directory) : root;
    const watcher = this.watchFn(absolute, {}, (_event, filename) =>
      this.handleWorktreeEvent(root, _event, filename, directory),
    );
    watcher.on("error", (error) => {
      this.switchToPolling(root, `watcher error: ${errorMessage(error)}`);
    });
    watchers.set(directory, watcher);
  }

  private closeDirectoryWatcher(root: string, directory: string): void {
    const watchers = this.directoryWatchers.get(root);
    const watcher = watchers?.get(directory);
    if (!watcher) {
      return;
    }
    watchers?.delete(directory);
    try {
      watcher.close();
    } catch {
      // Already closed.
    }
  }

  private closeWorktreeWatchers(root: string): void {
    const native = this.nativeWatchers.get(root);
    if (native) {
      this.nativeWatchers.delete(root);
      try {
        native.close();
      } catch {
        // Already closed.
      }
    }

    const watchers = this.directoryWatchers.get(root);
    if (watchers) {
      this.directoryWatchers.delete(root);
      for (const watcher of watchers.values()) {
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      }
    }
  }

  private handleWorktreeEvent(
    root: string,
    _event: string,
    filename: string | Buffer | null,
    directory = "",
  ): void {
    let changedPath: string | null = null;
    if (filename) {
      changedPath = filename.toString();
      if (isAbsolute(changedPath)) {
        changedPath = relativePath(root, changedPath);
      } else if (directory) {
        changedPath = `${directory}/${changedPath}`;
      }
      changedPath = changedPath.replaceAll("\\", "/");
      while (changedPath.startsWith("./")) {
        changedPath = changedPath.slice(2);
      }

      if (changedPath === ".git" || changedPath.startsWith(".git/")) {
        return;
      }

      if (
        changedPath === ".gitignore" ||
        changedPath.endsWith("/.gitignore")
      ) {
        this.ignoredDirs.delete(root);
        this.checkedDirs.delete(root);
      }

      if (this.isIgnoredPath(root, changedPath)) {
        return;
      }

      const absolute = join(root, changedPath);
      if (this.directoryWatchers.has(root)) {
        if (existsSync(absolute) && this.isDirectory(absolute)) {
          this.addDirectoryTree(root, changedPath);
        } else if (!existsSync(absolute)) {
          this.removeDirectoryWatchers(root, changedPath);
        }
      }
    }

    this.recordWorktreeChange(root, changedPath);
    this.schedule();
  }

  private isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private addDirectoryTree(root: string, directory: string): void {
    if (this.stopped || !this.directoryWatchers.has(root)) {
      return;
    }

    try {
      this.watchDirectory(root, directory);
    } catch (error) {
      this.switchToPolling(root, `watcher error: ${errorMessage(error)}`);
      return;
    }

    let entries;
    try {
      entries = readdirSync(join(root, directory), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") {
        continue;
      }
      const child = `${directory}/${entry.name}`;
      if (!this.isIgnoredPath(root, child)) {
        this.addDirectoryTree(root, child);
      }
    }
  }

  private removeDirectoryWatchers(root: string, directory: string): void {
    const watchers = this.directoryWatchers.get(root);
    if (!watchers) {
      return;
    }
    const prefix = `${directory}/`;
    for (const watched of [...watchers.keys()]) {
      if (watched === directory || watched.startsWith(prefix)) {
        this.closeDirectoryWatcher(root, watched);
      }
    }
  }

  private isIgnoredPath(root: string, path: string): boolean {
    const ignored = this.ignoredDirs.get(root);
    if (!ignored) {
      return false;
    }
    for (const directory of ignored) {
      if (path === directory || path.startsWith(`${directory}/`)) {
        return true;
      }
    }
    return false;
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

  private async listWatchDirectories(
    root: string,
    git: GitGateway,
  ): Promise<string[]> {
    const [tracked, others] = await Promise.all([
      git.text(["ls-files", "-z"]),
      git.text([
        "ls-files",
        "--others",
        "--exclude-standard",
        "--directory",
        "-z",
      ]),
    ]);

    const directories = new Set<string>([""]);
    const addParents = (file: string): void => {
      let current = dirname(file);
      while (current && current !== ".") {
        directories.add(current);
        const parent = dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      }
    };

    for (const file of nulTokens(tracked)) {
      addParents(file);
    }

    for (const token of nulTokens(others)) {
      const trimmed = token.replace(/\/$/, "");
      if (!trimmed) {
        continue;
      }
      if (token.endsWith("/") || this.isDirectory(join(root, trimmed))) {
        directories.add(trimmed);
        this.walkDirectories(root, trimmed, directories);
      } else {
        addParents(trimmed);
      }
    }

    const candidates = [...directories].filter((directory) => directory !== "");
    if (candidates.length === 0) {
      return [...directories];
    }

    const ignored = await this.checkIgnored(git, root, candidates);
    return [...directories].filter(
      (directory) =>
        directory === "" ||
        (!ignored.has(directory) && !this.isIgnoredPath(root, directory)),
    );
  }

  private walkDirectories(
    root: string,
    directory: string,
    directories: Set<string>,
  ): void {
    let entries;
    try {
      entries = readdirSync(join(root, directory), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") {
        continue;
      }
      const child = `${directory}/${entry.name}`;
      directories.add(child);
      this.walkDirectories(root, child, directories);
    }
  }

  private directoryAncestors(path: string): string[] {
    const parts = path.split("/").filter((part) => part !== "");
    const ancestors: string[] = [];
    let current = "";
    for (let index = 0; index < parts.length - 1; index++) {
      current = current ? `${current}/${parts[index]}` : (parts[index] ?? "");
      if (current) {
        ancestors.push(current);
      }
    }
    return ancestors;
  }

  private async checkIgnored(
    git: GitGateway,
    root: string,
    paths: readonly string[],
  ): Promise<Set<string>> {
    if (paths.length === 0) {
      return new Set();
    }

    const checked = this.checkedDirs.get(root) ?? new Set<string>();
    const newDirectories: string[] = [];
    for (const path of paths) {
      for (const ancestor of this.directoryAncestors(path)) {
        if (!checked.has(ancestor) && !newDirectories.includes(ancestor)) {
          newDirectories.push(ancestor);
        }
      }
    }

    try {
      const result = await git.run(["check-ignore", "--stdin", "-z"], {
        input: `${[...paths, ...newDirectories].join("\0")}\0`,
        allowExitCodes: [0, 1],
        timeoutMs: GIT_HEAVY_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return new Set();
      }

      const ignored = new Set(nulTokens(result.stdout.toString("utf8")));
      const cached = this.ignoredDirs.get(root) ?? new Set<string>();
      for (const directory of newDirectories) {
        checked.add(directory);
        if (ignored.has(directory)) {
          cached.add(directory);
        }
      }
      this.checkedDirs.set(root, checked);
      this.ignoredDirs.set(root, cached);
      return ignored;
    } catch {
      return new Set();
    }
  }

  private async unignoredPaths(
    git: GitGateway,
    root: string,
    paths: readonly string[],
  ): Promise<readonly string[]> {
    if (paths.length === 0) {
      return [];
    }

    const ignored = await this.checkIgnored(git, root, paths);
    return paths.filter(
      (path) => !ignored.has(path) && !this.isIgnoredPath(root, path),
    );
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
          root,
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

      const current = new Set(worktrees.worktrees.map((worktree) => worktree.path));
      for (const root of [...this.worktreeGit.keys()]) {
        if (!current.has(root)) {
          this.closeWorktreeWatchers(root);
          this.stopPolling(root);
          this.statusByWorktree.delete(root);
          this.worktreeGit.delete(root);
        }
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
        await this.setupWorktree(worktree.path);
      }
    } catch {
      // A transient git failure should not break the watcher.
    }
  }

  private async fingerprint(git: GitGateway): Promise<string> {
    const [status, refs, head] = await Promise.all([
      git.text(["status", "--porcelain=v2", "-z"], {
        timeoutMs: GIT_HEAVY_TIMEOUT_MS,
      }),
      git.text(["for-each-ref", "--format=%(refname) %(objectname)"]),
      git.run(["rev-parse", "--verify", "HEAD"], {
        allowExitCodes: [0, 128],
      }),
    ]);

    return `${status}\0${refs}\0${head.stdout.toString("utf8")}`;
  }

  private switchToPolling(root: string, reason: string): void {
    void this.startPolling(root, reason);
  }

  private async startPolling(root: string, reason: string): Promise<void> {
    if (
      this.stopped ||
      this.pollingStarting.has(root) ||
      this.pollTimers.has(root)
    ) {
      return;
    }

    this.pollingStarting.add(root);
    try {
      this.closeWorktreeWatchers(root);

      const git = this.worktreeGit.get(root);
      if (git) {
        try {
          this.pollFingerprints.set(root, await this.fingerprint(git));
        } catch {
          // Keep polling; the first successful comparison becomes the baseline.
        }
      }

      this.setStatus(root, "polling", reason);

      if (this.stopped || this.pollTimers.has(root)) {
        return;
      }

      const timer = setInterval(() => {
        void this.poll(root);
      }, this.pollIntervalMs);
      this.pollTimers.set(root, timer);
    } finally {
      this.pollingStarting.delete(root);
    }
  }

  private async poll(root: string): Promise<void> {
    if (this.stopped || this.pollingBusy.has(root)) {
      return;
    }

    const git = this.worktreeGit.get(root);
    if (!git) {
      return;
    }

    this.pollingBusy.add(root);
    try {
      const next = await this.fingerprint(git);
      const previous = this.pollFingerprints.get(root);
      this.pollFingerprints.set(root, next);
      if (previous !== undefined && previous !== next && !this.stopped) {
        this.onChanged();
        void this.refreshWorktreeWatchers();
      }
    } catch {
      // Keep the previous fingerprint and try again on the next poll.
    } finally {
      this.pollingBusy.delete(root);
    }
  }

  private stopPolling(root: string): void {
    const timer = this.pollTimers.get(root);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(root);
    }
    this.pollFingerprints.delete(root);
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
    for (const root of [...this.worktreeGit.keys()]) {
      this.closeWorktreeWatchers(root);
      this.stopPolling(root);
    }
    this.pendingCommon = false;
    this.pendingWorktrees.clear();
  }
}
