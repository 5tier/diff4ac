import { describe, expect, test } from "bun:test";

import {
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import type { RunningServer } from "../src/server/server";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { startFixtureServer, tempDirectory } from "./helpers/server";

interface HttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string | string[] | undefined>;
}


function authedGet(
  running: RunningServer,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return httpGet(running.port, path, {
    "x-diff4ac-token": running.token,
    ...headers,
  });
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
            headers: res.headers,
          });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repo.write("src/app.ts", "one\n");
  repo.commit("initial");
  repo.write("src/app.ts", "one\ntwo\n");
  return repo;
}

function webFixture(): string {
  const dir = realpathSync(tempDirectory("diff4ac-web-"));
  const assets = join(dir, "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    "<html><body>diff4ac fixture index</body></html>\n",
  );
  writeFileSync(join(assets, "main.js"), "console.log('fixture asset');\n");
  writeFileSync(join(dir, "secret.txt"), "outside assets\n");
  return dir;
}

async function serverFor(
  repo: FixtureRepo,
  webDir?: string,
): Promise<RunningServer> {
  return (
    await startFixtureServer({ repo, ...(webDir ? { webDir } : {}) })
  ).running;
}

describe("HTTP server security", () => {
  test("binds to 127.0.0.1 and wires the API to the Pending Change Set", async () => {
    const repo = fixture();
    const running = await serverFor(repo);

    expect(running.server.hostname).toBe("127.0.0.1");
    expect(running.url.startsWith("http://127.0.0.1:")).toBe(true);

    const response = await authedGet(running, "/api/pending");

    expect(response.status).toBe(200);
    const changeSet = JSON.parse(response.body) as {
      files: { path: string; diff: string }[];
      totals: { files: number };
    };
    expect(changeSet.totals.files).toBe(1);
    expect(changeSet.files[0]?.path).toBe("src/app.ts");
    expect(changeSet.files[0]?.diff).toContain("+two");
  });

  test("wires the API to the commit list and a single-commit Change Set", async () => {
    const repo = fixture();
    const second = repo.commit("second");
    const running = await serverFor(repo);

    const listResponse = await authedGet(running, "/api/commits");
    expect(listResponse.status).toBe(200);
    const list = JSON.parse(listResponse.body) as {
      commits: { hash: string; message: string }[];
    };
    expect(list.commits.map((commit) => commit.message)).toEqual([
      "second",
      "initial",
    ]);

    const commitResponse = await authedGet(
      running,
      `/api/commit?hash=${second}`,
    );
    expect(commitResponse.status).toBe(200);
    const changeSet = JSON.parse(commitResponse.body) as {
      selection: { kind: string; commit: { hash: string } };
      files: { path: string; diff: string }[];
    };
    expect(changeSet.selection.kind).toBe("commit");
    expect(changeSet.selection.commit.hash).toBe(second);
    expect(changeSet.files[0]?.path).toBe("src/app.ts");
    expect(changeSet.files[0]?.diff).toContain("+two");

    const missing = await authedGet(running, "/api/commit");
    expect(missing.status).toBe(400);
  });

  test("wires the API to the branch list and a branch Change Set", async () => {
    const repo = fixture();
    repo.git(["checkout", "-q", "-b", "feature"]);
    repo.write("feature.txt", "feature\n");
    repo.commit("feature work");
    const running = await serverFor(repo);

    const listResponse = await authedGet(running, "/api/branches");
    expect(listResponse.status).toBe(200);
    const list = JSON.parse(listResponse.body) as {
      baseBranch: { name: string; ref: string };
      branches: { name: string; current: boolean }[];
    };
    expect(list.baseBranch).toEqual({ name: "main", ref: "main" });
    expect(list.branches.map((branch) => branch.name)).toEqual([
      "feature",
      "main",
    ]);
    expect(
      list.branches.find((branch) => branch.name === "feature")?.current,
    ).toBe(true);

    const branchResponse = await authedGet(
      running,
      "/api/branch?name=feature",
    );
    expect(branchResponse.status).toBe(200);
    const changeSet = JSON.parse(branchResponse.body) as {
      selection: { kind: string; branch: { name: string } };
      files: { path: string }[];
    };
    expect(changeSet.selection.kind).toBe("branch");
    expect(changeSet.selection.branch.name).toBe("feature");
    expect(changeSet.files.map((file) => file.path)).toContain("feature.txt");

    const missing = await authedGet(running, "/api/branch?name=nope");
    expect(missing.status).toBe(404);
  });

  test("wires the API to a multi-commit Change Set and its view modes", async () => {
    const repo = createFixtureRepo();
    repo.write("a.txt", "one\n");
    repo.commit("first");
    repo.write("b.txt", "two\n");
    const second = repo.commit("second");
    repo.write("c.txt", "three\n");
    const third = repo.commit("third");
    const running = await serverFor(repo);

    const net = await authedGet(
      running,
      `/api/commit-set?hashes=${third},${second}&mode=net`,
    );
    expect(net.status).toBe(200);
    const netSet = JSON.parse(net.body) as {
      selection: { kind: string; mode: string; contiguous: boolean };
      files: { path: string }[];
    };
    expect(netSet.selection).toMatchObject({
      kind: "commits",
      mode: "net",
      contiguous: true,
    });
    expect(netSet.files.map((file) => file.path)).toEqual(["b.txt", "c.txt"]);

    const stack = await authedGet(
      running,
      `/api/commit-set?hashes=${third},${second}&mode=stack`,
    );
    expect(stack.status).toBe(200);
    const stackSet = JSON.parse(stack.body) as {
      commitGroups: { commit: { message: string } }[];
    };
    expect(stackSet.commitGroups.map((group) => group.commit.message)).toEqual(
      ["second", "third"],
    );

    const missingMode = await authedGet(
      running,
      `/api/commit-set?hashes=${third},${second}&mode=sideways`,
    );
    expect(missingMode.status).toBe(400);
  });

  test("requires the per-session token", async () => {
    const repo = fixture();
    const running = await serverFor(repo);

    expect((await httpGet(running.port, "/api/pending")).status).toBe(401);
    expect(
      (await httpGet(running.port, "/api/pending?token=wrong")).status,
    ).toBe(401);
    expect(
      (
        await httpGet(
          running.port,
          `/api/pending?token=${encodeURIComponent(running.token)}`,
        )
      ).status,
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
    const path = "/api/pending";

    const response = await authedGet(running, path, {
      host: "evil.example",
    });

    expect(response.status).toBe(403);
    expect(response.body).toContain("Host");
  });

  test("bootstraps the session cookie from the launch URL", async () => {
    const repo = fixture();
    const webDir = webFixture();
    const running = await serverFor(repo, webDir);
    const cookieName = `diff4ac_${running.port}`;

    const bootstrap = await httpGet(
      running.port,
      `/?token=${encodeURIComponent(running.token)}`,
    );
    expect(bootstrap.status).toBe(303);
    expect(bootstrap.headers["location"]).toBe("/");
    expect(bootstrap.body).toBe("");

    const setCookie = bootstrap.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(raw).toBeDefined();
    expect(raw).toContain(`${cookieName}=${encodeURIComponent(running.token)}`);
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Strict");
    expect(raw).toContain("Path=/");
    expect(raw).not.toContain("Secure");

    const cookie = raw?.split(";")[0] ?? "";
    const index = await httpGet(running.port, "/", { cookie });
    expect(index.status).toBe(200);
    expect(index.body).toContain("diff4ac fixture index");

    const pending = await httpGet(running.port, "/api/pending", { cookie });
    expect(pending.status).toBe(200);
    expect(pending.headers["set-cookie"]).toBeUndefined();

    const events = await fetch(
      `http://127.0.0.1:${running.port}/api/events`,
      { headers: { cookie } },
    );
    expect(events.status).toBe(200);
    await events.body?.cancel();

    const wrong = await httpGet(running.port, "/?token=wrong");
    expect(wrong.status).toBe(401);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  test("ignores ?token= on API requests and rejects wrong or foreign cookies", async () => {
    const repo = fixture();
    const running = await serverFor(repo);
    const other = await serverFor(repo);

    const viaQuery = await httpGet(
      running.port,
      `/api/pending?token=${encodeURIComponent(running.token)}`,
    );
    expect(viaQuery.status).toBe(401);

    const wrongCookie = await httpGet(running.port, "/api/pending", {
      cookie: `diff4ac_${running.port}=wrong`,
    });
    expect(wrongCookie.status).toBe(401);

    const foreignName = await httpGet(running.port, "/api/pending", {
      cookie: `diff4ac_${other.port}=${encodeURIComponent(running.token)}`,
    });
    expect(foreignName.status).toBe(401);

    const bootstrap = await httpGet(
      other.port,
      `/?token=${encodeURIComponent(other.token)}`,
    );
    const setCookie = bootstrap.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const otherCookie = raw?.split(";")[0] ?? "";
    expect(
      (await httpGet(running.port, "/api/pending", { cookie: otherCookie }))
        .status,
    ).toBe(401);
  });

  test("serves static assets without a token or cookie", async () => {
    const repo = fixture();
    const webDir = webFixture();
    const running = await serverFor(repo, webDir);

    const asset = await httpGet(running.port, "/assets/main.js");
    expect(asset.status).toBe(200);
    expect(asset.body).toContain("fixture asset");
    expect(asset.headers["set-cookie"]).toBeUndefined();
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");

    const rejectedHost = await httpGet(running.port, "/assets/main.js", {
      host: "evil.example",
    });
    expect(rejectedHost.status).toBe(403);

    expect((await httpGet(running.port, "/")).status).toBe(401);
    expect((await httpGet(running.port, "/api/pending")).status).toBe(401);

    const pending = await authedGet(running, "/api/pending");
    expect(pending.status).toBe(200);
    expect(pending.headers["set-cookie"]).toBeUndefined();
  });

  test("rejects traversal, directory and symlink escapes under assets", async () => {
    const repo = fixture();
    const webDir = webFixture();
    const assets = join(webDir, "assets");
    symlinkSync(join(webDir, "secret.txt"), join(assets, "leak.txt"));
    mkdirSync(join(assets, "nested"), { recursive: true });
    writeFileSync(join(assets, "nested", "secret.txt"), "nested inside assets\n");
    symlinkSync(
      join(assets, "nested", "secret.txt"),
      join(assets, "nested-link.txt"),
    );
    const running = await serverFor(repo, webDir);

    const normalisedEscape = await httpGet(
      running.port,
      "/assets/../index.html",
    );
    expect(normalisedEscape.status).toBe(401);
    expect(normalisedEscape.body).not.toContain("diff4ac fixture index");

    for (const path of [
      "/assets/%2e%2e%2findex.html",
      "/assets/..%2findex.html",
      "/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
      "/assets/%2e%2e%5cindex.html",
      "/assets/",
      "/assets",
      "/assets/leak.txt",
      "/assets/nested-link.txt",
    ]) {
      const response = await httpGet(running.port, path);
      expect(response.status).toBeLessThan(500);
      expect(response.status).not.toBe(200);
      expect(response.body).not.toContain("outside assets");
      expect(response.body).not.toContain("nested inside assets");
      expect(response.body).not.toContain("diff4ac fixture index");
    }

    const withToken = await httpGet(
      running.port,
      `/assets/%2e%2e%2findex.html?token=${encodeURIComponent(running.token)}`,
    );
    expect(withToken.status).toBe(404);
  });

  test("rejects requests with an unexpected Origin header", async () => {
    const repo = fixture();
    const running = await serverFor(repo);
    const path = "/api/pending";

    const rejected = await authedGet(running, path, {
      origin: "http://evil.example",
    });
    expect(rejected.status).toBe(403);
    expect(rejected.body).toContain("Origin");

    const accepted = await authedGet(running, path, {
      origin: `http://127.0.0.1:${running.port}`,
    });
    expect(accepted.status).toBe(200);
  });
});
