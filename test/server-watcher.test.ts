import { afterEach, describe, expect, test } from "bun:test";
import { cleanupFixtureServers } from "./helpers/server";

import type { ConfigInfo, SessionInfo } from "../shared/types";
import type { WatchFunction } from "../src/repository/watcher";
import { getJson, startFixtureServer } from "./helpers/server";

afterEach(cleanupFixtureServers);

describe("server watcher diagnostics", () => {
  test("reports polling and its reason on /api/config", async () => {
    const failingWatch: WatchFunction = () => {
      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    };

    const fixture = await startFixtureServer({
      watchFn: failingWatch,
      watchPollIntervalMs: 100,
    });

    const response = await getJson<ConfigInfo>(
      fixture.running,
      "/api/config",
    );
    expect(response.status).toBe(200);

    const status = response.body.watch?.find(
      (entry) => entry.path === fixture.repo.root,
    );
    expect(status?.mode).toBe("polling");
    expect(status?.reason).toContain("ENOSPC");

    const startup = fixture.running.config.watch?.find(
      (entry) => entry.path === fixture.repo.root,
    );
    expect(startup?.mode).toBe("polling");

    const session = await getJson<SessionInfo>(
      fixture.running,
      "/api/session",
    );
    expect(
      session.body.watch?.find((entry) => entry.path === fixture.repo.root)
        ?.mode,
    ).toBe("polling");
  });
});
