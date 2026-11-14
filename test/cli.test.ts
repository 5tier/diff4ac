import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureRepo } from "./helpers/fixture";
import { createTempHome } from "./helpers/home";

const PROJECT_ROOT = join(import.meta.dir, "..");
const CLI = join(PROJECT_ROOT, "src", "cli.ts");

function waitForOutput(
  stream: ReadableStream<Uint8Array>,
  pattern: RegExp,
  timeoutMs = 20_000,
): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(`timed out waiting for ${pattern}; output so far:\n${buffer}`),
        ),
      );
    }, timeoutMs);

    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            finish(() =>
              reject(
                new Error(`process output ended before match; output:\n${buffer}`),
              ),
            );
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const match = buffer.match(pattern);
          if (match) {
            finish(() => resolve(match));
            return;
          }
        }
      } catch (error) {
        finish(() => reject(error));
      }
    })();
  });
}

describe("diff4ac CLI", () => {
  test("exits non-zero with a clear error outside a Repository", async () => {
    const outside = mkdtempSync(join(tmpdir(), "diff4ac-not-a-repo-"));
    const home = createTempHome();
    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, CLI, outside, "--no-open"],
        cwd: PROJECT_ROOT,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: home.path },
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("is not inside a git Repository");
    } finally {
      rmSync(outside, { recursive: true, force: true });
      home.dispose();
    }
  });

  test("starts the server with --no-open and --port", async () => {
    const repo = createFixtureRepo();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    repo.write("src/app.ts", "one\ntwo\n");

    const home = createTempHome();
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        CLI,
        repo.root,
        "--no-open",
        "--port",
        "0",
      ],
      cwd: PROJECT_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home.path },
    });

    try {
      const match = await waitForOutput(proc.stdout, /Listening:\s+(http:\/\/\S+)/);
      const url = new URL(match[1] ?? "");
      const token = url.searchParams.get("token") ?? "";

      expect(url.hostname).toBe("127.0.0.1");
      expect(token.length).toBeGreaterThan(20);

      const response = await fetch(
        `${url.origin}/api/pending?token=${encodeURIComponent(token)}`,
      );
      expect(response.status).toBe(200);

      const changeSet = (await response.json()) as {
        files: { path: string }[];
      };
      expect(changeSet.files[0]?.path).toBe("src/app.ts");

      const index = await fetch(url);
      expect(index.status).toBe(200);
      const html = await index.text();
      expect(html).toContain('<div id="root"></div>');
      expect(html).not.toContain("__TOKEN__");

      const asset = await fetch(`${url.origin}/assets/main.js?token=${encodeURIComponent(token)}`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("diff4ac");
    } catch (error) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nCLI stderr:\n${stderr}`,
      );
    } finally {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
      }
      await proc.exited;
      repo.dispose();
      home.dispose();
    }
  });

  test("reports invalid config and still starts with defaults", async () => {
    const repo = createFixtureRepo();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");

    const home = createTempHome();
    home.writeGlobalConfig({ baseBranch: 42 });

    const proc = Bun.spawn({
      cmd: [process.execPath, CLI, repo.root, "--no-open", "--port", "0"],
      cwd: PROJECT_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home.path },
    });

    try {
      const diagnostic = await waitForOutput(
        proc.stderr,
        /config .*baseBranch.*using defaults/,
      );
      expect(diagnostic[0]).toContain(home.globalConfigPath);

      await waitForOutput(proc.stdout, /Listening:\s+http:\/\//);
    } finally {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
      }
      await proc.exited;
      repo.dispose();
      home.dispose();
    }
  });

  test("warns when the configured Base Branch does not exist", async () => {
    const repo = createFixtureRepo();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({ baseBranch: "missing" })}\n`,
    );

    const home = createTempHome();
    const proc = Bun.spawn({
      cmd: [process.execPath, CLI, repo.root, "--no-open", "--port", "0"],
      cwd: PROJECT_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home.path },
    });

    try {
      const diagnostic = await waitForOutput(
        proc.stderr,
        /config .*baseBranch.*branch "missing" not found; using auto-detection/,
      );
      expect(diagnostic[0]).toContain("config");
      await waitForOutput(proc.stdout, /Listening:\s+http:\/\//);
    } finally {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
      }
      await proc.exited;
      repo.dispose();
      home.dispose();
    }
  });
});
