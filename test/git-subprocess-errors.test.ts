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
if [ "$command" = "symbolic-ref" ]; then
  if [ "$FAKE_GIT_MODE" = "symbolic-empty-once" ] && [ ! -f "$FAKE_GIT_MARKER" ]; then
    : > "$FAKE_GIT_MARKER"
    exit 0
  fi
  if [ "$FAKE_GIT_MODE" = "symbolic-empty-always" ]; then
    exit 0
  fi
  printf 'agent/feature-x\n'
  exit 0
fi
if [ "$command" = "status" ]; then
  if [ "$FAKE_GIT_MODE" = "status-empty-ok" ]; then
    exit 0
  fi
  if [ "$FAKE_GIT_MODE" = "stderr-open" ]; then
    printf 'ok\n'
    sleep 1 1>/dev/null &
    exit 0
  fi
  if [ "$FAKE_GIT_MODE" = "lost-twice" ] || [ "$FAKE_GIT_MODE" = "lost-three" ]; then
    count=0
    if [ -f "$FAKE_GIT_MARKER" ]; then
      count=$(cat "$FAKE_GIT_MARKER")
    fi
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_GIT_MARKER"
    limit=2
    if [ "$FAKE_GIT_MODE" = "lost-three" ]; then
      limit=3
    fi
    if [ "$count" -le "$limit" ]; then
      sleep 1 &
      exit 0
    fi
    printf 'ok\n'
    exit 0
  fi
  if [ "$FAKE_GIT_MODE" = "lost-output" ]; then
    sleep 1 &
    exit 0
  fi
  if [ "$FAKE_GIT_MODE" = "timeout-pipe" ]; then
    trap 'sleep 0.2; exit 143' TERM
    sleep 1 &
    while :; do :; done
  fi
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
  mode:
    | "empty"
    | "timeout"
    | "sigpipe"
    | "symbolic-empty-once"
    | "symbolic-empty-always"
    | "status-empty-ok"
    | "lost-output"
    | "timeout-pipe"
    | "stderr-open"
    | "lost-twice"
    | "lost-three",
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

  test("retries an empty symbolic-ref once and returns the branch", async () => {
    const result = await runScenario("symbolic-empty-once");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("branch agent/feature-x");
    expect(result.stderr).toContain("retrying empty git output");
    expect(result.stderr).not.toContain("EmptyGitOutputError");
  });

  test("an always-empty symbolic-ref fails after two retries", async () => {
    const result = await runScenario("symbolic-empty-always");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("empty-symbolic");
    expect(
      result.stderr.match(/retrying empty git output/g) ?? [],
    ).toHaveLength(2);
  });

  test("emptyOk accepts empty output without a retry", async () => {
    const result = await runScenario("status-empty-ok");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("empty-ok");
    expect(result.stderr).not.toContain("retrying empty git output");
  });

  test("detects a lost pipe after exit without waiting for the timeout", async () => {
    const result = await runScenario("lost-output");
    expect(result.code).toBe(0);
    const match = /lost GitLostOutputError (\d+)/.exec(result.stdout);
    expect(match).not.toBeNull();
    expect(Number(match?.[1] ?? Infinity)).toBeLessThan(4000);
    expect(result.stderr).toContain("diff4ac: git lost output");
    expect(
      result.stderr.match(/retrying git after GitLostOutputError/g) ?? [],
    ).toHaveLength(2);
  });

  test("keeps a complete stdout when only stderr stalls", async () => {
    const result = await runScenario("stderr-open");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('stderr-open "ok"');
    expect(result.stdout).toContain("no-unhandled");
    expect(result.stdout).not.toMatch(/^unhandled \d+/m);
    expect(result.stderr).toContain("diff4ac: git lost stderr");
    expect(result.stderr).not.toContain("diff4ac: git lost output");
  });

  test("two lost outputs in a row still leave a retry", async () => {
    const result = await runScenario("lost-twice");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('lost-output-ok "ok"');
    expect(
      result.stderr.match(/retrying git after GitLostOutputError/g) ?? [],
    ).toHaveLength(2);
  });

  test("gives up after two retries when output stays lost", async () => {
    const result = await runScenario("lost-three");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("lost-output-error GitLostOutputError");
    expect(
      result.stderr.match(/retrying git after GitLostOutputError/g) ?? [],
    ).toHaveLength(2);
  });

  test("a timeout with a background pipe holder leaves no unhandled rejection", async () => {
    const result = await runScenario("timeout-pipe");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("timeout-pipe");
    expect(result.stdout).toContain("no-unhandled");
    expect(result.stderr).toContain("diff4ac: git timeout");
    expect(result.stderr).not.toContain("diff4ac: git lost output");
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
