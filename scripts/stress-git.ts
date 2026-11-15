import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureRepo } from "../test/helpers/fixture";
import { createTempHome } from "../test/helpers/home";
import { startServer } from "../src/server/server";

interface Outcome {
  readonly path: string;
  readonly kind: "ok" | "http" | "timeout" | "network";
  readonly status?: number;
  readonly detail?: string;
}

const rounds = Number(process.env.STRESS_ROUNDS ?? 100);
const concurrency = Number(process.env.STRESS_CONCURRENCY ?? 8);
const loadWorkers = Number(process.env.STRESS_LOAD_WORKERS ?? 4);

const repo = createFixtureRepo();
repo.write("src/app.ts", "base\n");
repo.write("src/move-old.ts", "alpha\nbeta\ngamma\ndelta\n");
repo.commit("base");
const hashes: string[] = [];
for (let index = 0; index < 20; index++) {
  repo.write("src/app.ts", `base ${index}\n`);
  repo.write(`src/file-${index}.ts`, `content ${index}\n`);
  hashes.push(repo.commit(`commit ${index}`));
}
repo.write("src/app.ts", "pending\n");
repo.rename("src/move-old.ts", "src/move-new.ts");

const stateDir = mkdtempSync(join(tmpdir(), "diff4ac-stress-state-"));
const home = createTempHome();
const running = await startServer({
  repoPath: repo.root,
  stateDir,
  homeDir: home.path,
  commitPageSize: 10,
});

const paths = [
  "/api/commits?skip=1",
  "/api/commits",
  "/api/pending",
  `/api/commit-set?hashes=${hashes.slice(-3).join(",")}&mode=stack`,
  `/api/worktrees`,
  `/api/branches`,
];

const header = { "x-diff4ac-token": running.token };
const outcomes: Outcome[] = [];
let nextRound = 0;
let stopLoad = false;

async function one(path: string): Promise<Outcome> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${running.port}${path}`,
      { headers: header, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      return {
        path,
        kind: "http",
        status: response.status,
        detail: (await response.text()).slice(0, 300),
      };
    }
    await response.arrayBuffer();
    return { path, kind: "ok", status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("timed out") || message.includes("Timeout")) {
      return { path, kind: "timeout", detail: message };
    }
    return { path, kind: "network", detail: message };
  }
}

const loadShell = `
  for i in $(seq 1 80); do
    git --no-optional-locks status --porcelain >/dev/null 2>&1 || true
    git --no-optional-locks rev-list --all >/dev/null 2>&1 || true
  done
`;

const loaders = Array.from({ length: loadWorkers }, () =>
  Bun.spawn(["sh", "-c", loadShell], {
    cwd: repo.root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }),
);

async function worker(): Promise<void> {
  while (!stopLoad) {
    const round = nextRound++;
    if (round >= rounds) {
      return;
    }
    const path = paths[round % paths.length] as string;
    outcomes.push(await one(path));
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
stopLoad = true;
await Promise.all(loaders.map((loader) => loader.exited));

function lingeringGitProcesses(): string[] {
  try {
    const output = Bun.spawnSync({
      cmd: ["ps", "-Ao", "pid=,ppid=,command="],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    }).stdout.toString("utf8");
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.includes("--no-optional-locks") &&
          line.includes(repo.root),
      );
  } catch {
    return [];
  }
}

const summary = {
  elapsedMs: Date.now() - started,
  rounds,
  concurrency,
  loadWorkers,
  total: outcomes.length,
  ok: outcomes.filter((entry) => entry.kind === "ok").length,
  http: outcomes.filter((entry) => entry.kind === "http").length,
  timeout: outcomes.filter((entry) => entry.kind === "timeout").length,
  network: outcomes.filter((entry) => entry.kind === "network").length,
  failures: outcomes.filter((entry) => entry.kind !== "ok"),
  lingeringGitProcesses: lingeringGitProcesses(),
};

console.log(JSON.stringify(summary, null, 2));

running.stop();
repo.dispose();
home.dispose();
rmSync(stateDir, { recursive: true, force: true });
