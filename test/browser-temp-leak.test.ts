import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTempDirectory } from "./helpers/cleanup";

const ROOT = join(import.meta.dir, "..");
const PLAYWRIGHT_PREFIXES = [
  "playwright_chromiumdev_profile-",
  "playwright-artifacts-",
];

function playwrightFolders(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) =>
      PLAYWRIGHT_PREFIXES.some((prefix) => name.startsWith(prefix)),
    )
    .sort();
}

describe("browser temp folders", () => {
  test(
    "a browser test process removes its Playwright profile and artifacts",
    async () => {
      // Isolate TMPDIR so folders made by other test processes cannot affect
      // the comparison, then run one browser test file in a child process.
      const isolated = createTempDirectory("diff4ac-browser-leak-");
      expect(playwrightFolders(isolated)).toEqual([]);

      const proc = Bun.spawn({
        cmd: [process.execPath, "test", "test/playwright-diff.test.ts"],
        cwd: ROOT,
        env: { ...process.env, TMPDIR: isolated },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
      expect(playwrightFolders(isolated)).toEqual([]);
    },
    60_000,
  );
});
