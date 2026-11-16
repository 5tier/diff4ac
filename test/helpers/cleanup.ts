import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN_ID = `${process.pid.toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

/** Every temp directory created by this test process carries this prefix. */
export const TEMP_RUN_PREFIX = `diff4ac-${RUN_ID}-`;

type Cleanup = () => void;

const cleanups: Cleanup[] = [];
const suiteCleanups: Cleanup[] = [];
let testCleanupStart = 0;

function taggedPrefix(prefix: string): string {
  const suffix = prefix.startsWith("diff4ac-")
    ? prefix.slice("diff4ac-".length)
    : prefix;
  return `${TEMP_RUN_PREFIX}${suffix}`;
}

/** Register work that must run before its temp directories are removed. */
export function registerCleanup(cleanup: Cleanup): void {
  cleanups.push(cleanup);
}

export function registerSuiteCleanup(cleanup: Cleanup): void {
  suiteCleanups.push(cleanup);
}

export function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), taggedPrefix(prefix)));
  registerCleanup(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

export function removeTempDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

/** Called by the global preload before each test. */
export function beginTestCleanupScope(): void {
  testCleanupStart = cleanups.length;
}

function runFrom(start: number): void {
  for (let index = cleanups.length - 1; index >= start; index--) {
    const cleanup = cleanups[index];
    if (!cleanup) {
      continue;
    }
    try {
      cleanup();
    } catch {
      // Best effort: one broken fixture must not hide the others.
    }
  }
  cleanups.splice(start);
}

/** Run only resources created by the just-finished test. */
export function cleanupTest(): void {
  runFrom(testCleanupStart);
  testCleanupStart = 0;
}

/** Run every remaining cleanup, including suite-scoped fixtures. */
export function cleanupAll(): void {
  runFrom(0);
  for (let index = suiteCleanups.length - 1; index >= 0; index--) {
    const cleanup = suiteCleanups[index];
    if (!cleanup) {
      continue;
    }
    try {
      cleanup();
    } catch {
      // Best effort.
    }
  }
  suiteCleanups.length = 0;
  testCleanupStart = 0;
}

/** Fail if this process left any of its own temp directories behind. */
export function assertNoTempDirectoryLeaks(): void {
  const leftover = readdirSync(tmpdir()).filter((name) =>
    name.startsWith(TEMP_RUN_PREFIX),
  );
  if (leftover.length > 0) {
    throw new Error(
      `test temp directory leak: ${leftover.join(", ")}`,
    );
  }
}
