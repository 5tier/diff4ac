import { describe, expect, test } from "bun:test";
import { renameSync } from "node:fs";
import { join } from "node:path";

import { createFixtureRepo } from "./helpers/fixture";
import { getJson, startFixtureServer } from "./helpers/server";

const GENERIC =
  /^Internal error \(id ([0-9a-f]{8})\)\. See the diff4ac terminal for details\.$/;

function captureConsoleError(): {
  readonly lines: string[];
  readonly restore: () => void;
} {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(
      args
        .map((arg) => (typeof arg === "string" ? arg : String(arg)))
        .join(" "),
    );
  };
  return {
    lines,
    restore: () => {
      console.error = original;
    },
  };
}

async function serverWithBrokenRepository() {
  const repo = createFixtureRepo();
  repo.write("src/app.ts", "one\n");
  repo.commit("initial");
  const running = (
    await startFixtureServer({
      repo,
      watchStrategy: "polling",
      watchPollIntervalMs: 60_000,
    })
  ).running;

  renameSync(join(repo.root, ".git"), join(repo.root, ".git-broken"));
  return { repo, running };
}

function expectNoLeak(message: string, repoRoot: string): void {
  expect(message).not.toContain("git ");
  expect(message).not.toContain("exit code");
  expect(message).not.toContain("fatal:");
  expect(message).not.toContain("not a git repository");
  expect(message).not.toContain(repoRoot);
}

describe("unexpected server failures", () => {
  test("a JSON endpoint returns a generic 500 carrying the logged id", async () => {
    const { repo, running } = await serverWithBrokenRepository();
    const capture = captureConsoleError();
    try {
      const response = await getJson<{ readonly error?: unknown }>(
        running,
        "/api/worktrees",
      );
      expect(response.status).toBe(500);
      expect(typeof response.body).toBe("object");
      const message = response.body.error;
      expect(typeof message).toBe("string");
      expect(message).toMatch(GENERIC);
      expectNoLeak(message as string, repo.root);

      const id = GENERIC.exec(message as string)?.[1];
      expect(id).toBeDefined();
      const logLine = capture.lines.find((line) => line.includes(id as string));
      expect(logLine).toBeDefined();
      expect(logLine).toContain("not a git repository");
    } finally {
      capture.restore();
    }
  });

  test("a plain-text endpoint gets the same generic text", async () => {
    const { repo, running } = await serverWithBrokenRepository();
    const capture = captureConsoleError();
    try {
      const response = await getJson<unknown>(running, "/api/pending");
      expect(response.status).toBe(500);
      expect(typeof response.body).toBe("string");
      const message = response.body as string;
      expect(message).toMatch(GENERIC);
      expectNoLeak(message, repo.root);

      const id = GENERIC.exec(message)?.[1];
      expect(id).toBeDefined();
      const logLine = capture.lines.find((line) => line.includes(id as string));
      expect(logLine).toBeDefined();
      expect(logLine).toContain("not a git repository");
    } finally {
      capture.restore();
    }
  });
});
