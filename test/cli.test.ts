import { describe, expect, test } from "bun:test";
import { createTempDirectory } from "./helpers/cleanup";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createFixtureRepo } from "./helpers/fixture";
import { createTempHome } from "./helpers/home";

const PROJECT_ROOT = join(import.meta.dir, "..");
const CLI = join(PROJECT_ROOT, "src", "cli.ts");
const PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"),
  ) as { version: string }
).version;

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
    const outside = createTempDirectory("diff4ac-not-a-repo-");
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

      const response = await fetch(`${url.origin}/api/pending`, {
        headers: { "x-diff4ac-token": token },
      });
      expect(response.status).toBe(200);

      const changeSet = (await response.json()) as {
        files: { path: string }[];
      };
      expect(changeSet.files[0]?.path).toBe("src/app.ts");

      const bootstrap = await fetch(url, { redirect: "manual" });
      expect(bootstrap.status).toBe(303);
      expect(bootstrap.headers.get("location")).toBe("/");
      const setCookie = bootstrap.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`diff4ac_${url.port}=`);
      const cookie = setCookie.split(";")[0] ?? "";

      const index = await fetch(`${url.origin}/`, { headers: { cookie } });
      expect(index.status).toBe(200);
      const html = await index.text();
      expect(html).toContain('<div id="root"></div>');
      expect(html).not.toContain("__TOKEN__");

      const asset = await fetch(`${url.origin}/assets/main.js`);
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

  test("refuses to build the SPA inside the reviewed Repository", async () => {
    const repo = createFixtureRepo();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    const home = createTempHome();

    try {
      const before = repo.git([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);

      const proc = Bun.spawn({
        cmd: [process.execPath, CLI, repo.root, "--no-open", "--port", "0"],
        cwd: PROJECT_ROOT,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: home.path,
          DIFF4AC_PROJECT_ROOT: repo.root,
        },
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).toBe(1);
      expect(stderr).toContain(
        `diff4ac: the SPA is not built; run "bun run build" in ${repo.root} first`,
      );
      expect(existsSync(join(repo.root, "dist"))).toBe(false);
      expect(
        repo.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      ).toBe(before);
    } finally {
      repo.dispose();
      home.dispose();
    }
  });

  test("reports the package version in --version and the startup banner", async () => {
    const home = createTempHome();
    const versionProc = Bun.spawn({
      cmd: [process.execPath, CLI, "--version"],
      cwd: PROJECT_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home.path },
    });
    const versionOut = await new Response(versionProc.stdout).text();
    expect(await versionProc.exited).toBe(0);
    expect(versionOut.trim()).toBe(PACKAGE_VERSION);

    const repo = createFixtureRepo();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    const proc = Bun.spawn({
      cmd: [process.execPath, CLI, repo.root, "--no-open", "--port", "0"],
      cwd: PROJECT_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home.path },
    });
    try {
      const escaped = PACKAGE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const banner = await waitForOutput(
        proc.stdout,
        new RegExp(`diff4ac ${escaped}`),
      );
      expect(banner[0]).toBe(`diff4ac ${PACKAGE_VERSION}`);
    } finally {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
      }
      await proc.exited;
      repo.dispose();
      home.dispose();
    }
  });

  test("names an unwritable install folder and how to fix it", async () => {
    const repo = createFixtureRepo();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");
    const home = createTempHome();
    const install = createTempDirectory("diff4ac-readonly-install-");
    chmodSync(install, 0o555);

    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, CLI, repo.root, "--no-open", "--port", "0"],
        cwd: PROJECT_ROOT,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: home.path,
          DIFF4AC_PROJECT_ROOT: install,
        },
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).toBe(1);
      expect(stderr).toContain(`cannot build the web UI in ${install}`);
      expect(stderr).toContain("not writable");
      expect(stderr).toContain("writable folder");
    } finally {
      chmodSync(install, 0o755);
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
