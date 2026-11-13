import { afterEach, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { startServer, type RunningServer } from "../src/server/server";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

const repos: FixtureRepo[] = [];
const servers: RunningServer[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repo.write("src/app.ts", "one\n");
  repo.commit("initial");
  repo.write("src/app.ts", "one\ntwo\n");
  repos.push(repo);
  return repo;
}

async function serverFor(repo: FixtureRepo): Promise<RunningServer> {
  const running = await startServer({ repoPath: repo.root });
  servers.push(running);
  return running;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

describe("HTTP server security", () => {
  test("binds to 127.0.0.1 and wires the API to the Pending Change Set", async () => {
    const repo = fixture();
    const running = await serverFor(repo);

    expect(running.server.hostname).toBe("127.0.0.1");
    expect(running.url.startsWith("http://127.0.0.1:")).toBe(true);

    const response = await httpGet(
      running.port,
      `/api/pending?token=${encodeURIComponent(running.token)}`,
    );

    expect(response.status).toBe(200);
    const changeSet = JSON.parse(response.body) as {
      files: { path: string; diff: string }[];
      totals: { files: number };
    };
    expect(changeSet.totals.files).toBe(1);
    expect(changeSet.files[0]?.path).toBe("src/app.ts");
    expect(changeSet.files[0]?.diff).toContain("+two");
  });

  test("requires the per-session token", async () => {
    const repo = fixture();
    const running = await serverFor(repo);

    expect((await httpGet(running.port, "/api/pending")).status).toBe(401);
    expect(
      (await httpGet(running.port, "/api/pending?token=wrong")).status,
    ).toBe(401);

    const accepted = await httpGet(running.port, "/api/pending", {
      "x-diff4ac-token": running.token,
    });
    expect(accepted.status).toBe(200);

    const bearer = await httpGet(running.port, "/api/pending", {
      authorization: `Bearer ${running.token}`,
    });
    expect(bearer.status).toBe(200);
  });

  test("uses a fresh token for every session", async () => {
    const repo = fixture();
    const first = await serverFor(repo);
    const second = await serverFor(repo);

    expect(first.token).not.toBe(second.token);
  });

  test("rejects requests with an unexpected Host header", async () => {
    const repo = fixture();
    const running = await serverFor(repo);
    const path = `/api/pending?token=${encodeURIComponent(running.token)}`;

    const response = await httpGet(running.port, path, {
      host: "evil.example",
    });

    expect(response.status).toBe(403);
    expect(response.body).toContain("Host");
  });

  test("rejects requests with an unexpected Origin header", async () => {
    const repo = fixture();
    const running = await serverFor(repo);
    const path = `/api/pending?token=${encodeURIComponent(running.token)}`;

    const rejected = await httpGet(running.port, path, {
      origin: "http://evil.example",
    });
    expect(rejected.status).toBe(403);
    expect(rejected.body).toContain("Origin");

    const accepted = await httpGet(running.port, path, {
      origin: `http://127.0.0.1:${running.port}`,
    });
    expect(accepted.status).toBe(200);
  });
});
