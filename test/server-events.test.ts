import { describe, expect, test } from "bun:test";

import type { FixtureRepo } from "./helpers/fixture";
import { createFixtureRepo } from "./helpers/fixture";
import type { RunningServer } from "../src/server/server";
import { startFixtureServer } from "./helpers/server";


function fixture(): FixtureRepo {
  return createFixtureRepo();
}

interface EventStream {
  readonly response: Response;
  text(): string;
  waitFor(text: string, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

async function openEventStream(running: RunningServer): Promise<EventStream> {
  const response = await fetch(
    `http://127.0.0.1:${running.port}/api/events`,
    { headers: { "x-diff4ac-token": running.token } },
  );
  if (!response.body) {
    throw new Error("expected an SSE body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  let stopped = false;
  const pump = (async () => {
    while (!stopped) {
      try {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        received += decoder.decode(result.value, { stream: true });
      } catch {
        break;
      }
    }
  })();

  return {
    response,
    text: () => received,
    async waitFor(text, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (!received.includes(text)) {
        if (Date.now() > deadline) {
          throw new Error(`SSE stream did not receive ${JSON.stringify(text)}`);
        }
        await Bun.sleep(20);
      }
    },
    async stop() {
      stopped = true;
      await reader.cancel();
      await pump.catch(() => {});
    },
  };
}

describe("Repository change events", () => {
  test("debounces a burst of changes into one SSE event", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");

    const running = (
      await startFixtureServer({ repo, watchDebounceMs: 200 })
    ).running;

    const stream = await openEventStream(running);
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toContain(
      "text/event-stream",
    );

    try {
      await stream.waitFor("connected");

      repo.write("src/one.ts", "one\n");
      repo.write("src/two.ts", "two\n");
      repo.stage("src/one.ts", "src/two.ts");

      await stream.waitFor("event: repository-changed");
      await Bun.sleep(600);
      const count =
        stream.text().match(/event: repository-changed/g)?.length ?? 0;
      expect(count).toBe(1);
    } finally {
      await stream.stop();
    }
  });

  test("drops events caused only by git-ignored files", async () => {
    const repo = fixture();
    repo.write(".gitignore", "node_modules/\n");
    repo.commit("initial");

    const running = (
      await startFixtureServer({ repo, watchDebounceMs: 100 })
    ).running;

    const stream = await openEventStream(running);
    try {
      await stream.waitFor("connected");

      repo.write("node_modules/x.js", "ignored\n");
      await Bun.sleep(600);
      expect(stream.text()).not.toContain("event: repository-changed");

      repo.write("src/tracked.ts", "tracked\n");
      await stream.waitFor("event: repository-changed");
      await Bun.sleep(400);
      const count =
        stream.text().match(/event: repository-changed/g)?.length ?? 0;
      expect(count).toBe(1);
    } finally {
      await stream.stop();
    }
  });

  test("requires the session token for the SSE stream", async () => {
    const repo = fixture();
    repo.write("src/app.ts", "one\n");
    repo.commit("initial");

    const running = (await startFixtureServer({ repo })).running;

    const unauthorized = await fetch(
      `http://127.0.0.1:${running.port}/api/events`,
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(
      `http://127.0.0.1:${running.port}/api/events`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    expect(authorized.status).toBe(200);
    await authorized.body?.cancel();
  });
});
