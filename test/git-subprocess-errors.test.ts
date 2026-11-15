import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDirectory } from "./helpers/cleanup";

const originalPath = process.env.PATH;
const bin = createTempDirectory("diff4ac-fake-git-");
const git = join(bin, "git");

writeFileSync(
  git,
  `#!/bin/sh
shift
command="$1"
shift
if [ "$command" = "rev-parse" ] && [ "$1" = "--show-toplevel" ]; then
  if [ "$FAKE_GIT_MODE" = "empty" ]; then
    exit 0
  fi
  printf '%s\\n' "$FAKE_GIT_ROOT"
  exit 0
fi
if [ "$command" = "status" ]; then
  if [ "$FAKE_GIT_MODE" = "timeout" ]; then
    exec sleep 5
  fi
  if [ "$FAKE_GIT_MODE" = "sigpipe" ] && [ ! -f "$FAKE_GIT_MARKER" ]; then
    : > "$FAKE_GIT_MARKER"
    exit 141
  fi
  printf 'ok\\n'
  exit 0
fi
exit 1
`,
);
chmodSync(git, 0o755);

afterAll(() => {
  process.env.PATH = originalPath;
});

async function runScenario(
  mode: "empty" | "timeout" | "sigpipe",
): Promise<{ code: number; stdout: string; stderr: string }> {
  const marker = join(bin, `marker-${mode}`);
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      join(import.meta.dir, "helpers", "git-error-scenarios.ts"),
    ],
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      PATH: `${bin}:${originalPath ?? ""}`,
      FAKE_GIT_ROOT: join(import.meta.dir, ".."),
      FAKE_GIT_MODE: mode,
      FAKE_GIT_MARKER: marker,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("git subprocess failures", () => {
  test("retries a read-only call that exits 141 once", async () => {
    const result = await runScenario("sigpipe");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("retried");
    expect(result.stderr).toContain("retrying git after GitError");
  });

  test("treats empty rev-parse output as an error, not a missing repo", async () => {
    const result = await runScenario("empty");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("empty-output");
    expect(result.stderr).toContain("retrying empty git output");
  });

  test("times out, logs diagnostics, and retries once", async () => {
    const result = await runScenario("timeout");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("timeout");
    expect(result.stderr).toContain("GitTimeoutError");
    expect(result.stderr).toContain('"processAlive":true');
    expect(result.stderr).toContain('"exitedResolved":false');
    expect(result.stderr).toContain(
      "retrying git after GitTimeoutError: git status --porcelain",
    );
  });
});
