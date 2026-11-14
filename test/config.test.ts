import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBranchChangeSet } from "../src/changeset/branch";
import { GitGateway } from "../src/git/gateway";
import { loadConfig } from "../src/config/loader";
import { DEFAULT_NOISE_PATTERNS } from "../src/filters";
import { applyKeybindingOverrides } from "../src/keymap";
import { startServer, type RunningServer } from "../src/server/server";
import type { BranchList, ConfigInfo } from "../src/types";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";
import { createTempHome, type TempHome } from "./helpers/home";

const repos: FixtureRepo[] = [];
const homes: TempHome[] = [];
const servers: RunningServer[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

function tempHome(): TempHome {
  const home = createTempHome();
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
  for (const home of homes.splice(0)) {
    home.dispose();
  }
});

function keyFor(
  overrides: Readonly<Record<string, string>>,
  id: string,
): string | undefined {
  return applyKeybindingOverrides(overrides).find(
    (binding) => binding.id === id,
  )?.key;
}

describe("Config Loader", () => {
  test("returns built-in defaults when no config files exist", () => {
    const home = tempHome();
    const repo = fixture();

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config).toEqual({
      baseBranch: null,
      keybindings: {},
      agents: [],
      noise: DEFAULT_NOISE_PATTERNS,
      theme: "system",
      diagnostics: [],
    });
    expect(keyFor(config.keybindings, "commits.moveUp")).toBe("k");
  });

  test("merges defaults, global config and Repository config in precedence order", () => {
    const home = tempHome();
    const repo = fixture();

    home.writeGlobalConfig({
      baseBranch: "develop",
      keybindings: {
        "commits.moveDown": "u",
        "global.focusFiles": "g",
      },
    });
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify(
        {
          baseBranch: "release",
          keybindings: {
            "commits.moveDown": "e",
            "commits.select": "l",
          },
        },
        null,
        2,
      )}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.diagnostics).toEqual([]);
    expect(config.baseBranch).toBe("release");
    expect(config.keybindings).toEqual({
      "commits.moveDown": "e",
      "global.focusFiles": "g",
      "commits.select": "l",
    });
    expect(keyFor(config.keybindings, "commits.moveDown")).toBe("e");
    expect(keyFor(config.keybindings, "commits.select")).toBe("l");
    expect(keyFor(config.keybindings, "global.focusFiles")).toBe("g");
    expect(keyFor(config.keybindings, "commits.moveUp")).toBe("k");
  });

  test("reads a valid theme from config with Repository precedence", () => {
    const home = tempHome();
    const repo = fixture();

    home.writeGlobalConfig({ theme: "light" });
    repo.write(".diff4ac.json", `${JSON.stringify({ theme: "dark" })}\n`);

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.theme).toBe("dark");
    expect(config.diagnostics).toEqual([]);
  });

  test("falls back to system for an invalid theme and reports it", () => {
    const home = tempHome();
    const repo = fixture();

    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({ theme: "sepia" })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.theme).toBe("system");
    expect(config.diagnostics).toEqual([
      expect.objectContaining({
        file: join(repo.root, ".diff4ac.json"),
        field: "theme",
      }),
    ]);
  });

  test("merges Noise patterns with Repository precedence", () => {
    const home = tempHome();
    const repo = fixture();

    home.writeGlobalConfig({ noise: ["**/global/**"] });
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({ noise: ["**/repo/**"] })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.noise).toEqual(["**/repo/**"]);
    expect(config.diagnostics).toEqual([]);
  });

  test("allows an explicit empty Noise list to disable the built-ins", () => {
    const home = tempHome();
    const repo = fixture();

    repo.write(".diff4ac.json", `${JSON.stringify({ noise: [] })}\n`);

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.noise).toEqual([]);
    expect(config.diagnostics).toEqual([]);
  });

  test("reports invalid Noise config and falls back to the lower-precedence value", () => {
    const home = tempHome();
    const repo = fixture();

    home.writeGlobalConfig({ noise: ["**/global/**"] });
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({ noise: ["ok/**", 42] })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.noise).toEqual(["**/global/**"]);
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: join(repo.root, ".diff4ac.json"),
          field: "noise",
        }),
      ]),
    );
  });

  test("reports invalid fields with file and field names while keeping valid values", () => {
    const home = tempHome();
    const repo = fixture();

    home.writeGlobalConfig("{ not json");
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({
        baseBranch: 42,
        keybindings: {
          unknownBinding: "x",
          "commits.moveUp": 5,
          "commits.select": "l",
        },
      })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });

    expect(config.baseBranch).toBeNull();
    expect(config.keybindings).toEqual({ "commits.select": "l" });
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === home.globalConfigPath &&
          diagnostic.field === "(file)",
      ),
    ).toBe(true);
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === join(repo.root, ".diff4ac.json") &&
          diagnostic.field === "baseBranch",
      ),
    ).toBe(true);
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === join(repo.root, ".diff4ac.json") &&
          diagnostic.field === "keybindings.unknownBinding",
      ),
    ).toBe(true);
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === join(repo.root, ".diff4ac.json") &&
          diagnostic.field === "keybindings.commits.moveUp",
      ),
    ).toBe(true);
  });

  test("rejects conflicting keybinding overrides and keeps defaults", () => {
    const home = tempHome();
    const repo = fixture();

    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({
        keybindings: {
          "commits.moveDown": "k",
          "global.focusFiles": "m",
          "time-window.close": "?",
          "commits.select": "l",
        },
      })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });
    const configFile = join(repo.root, ".diff4ac.json");

    expect(config.keybindings).toEqual({ "commits.select": "l" });
    expect(keyFor(config.keybindings, "commits.moveDown")).toBe("j");
    expect(keyFor(config.keybindings, "global.focusFiles")).toBe("4");
    expect(keyFor(config.keybindings, "time-window.close")).toBe("Escape");

    const field = (id: string) => `keybindings.${id}`;
    const hasConflict = (id: string, conflictId: string) =>
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === configFile &&
          diagnostic.field === field(id) &&
          diagnostic.message.includes(conflictId),
      );

    expect(hasConflict("commits.moveDown", "commits.moveUp")).toBe(true);
    expect(hasConflict("global.focusFiles", "files.toggleMark")).toBe(true);
    expect(hasConflict("time-window.close", "global.help")).toBe(true);
  });

  test("rejects two overrides that conflict with each other", () => {
    const home = tempHome();
    const repo = fixture();

    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({
        keybindings: {
          "commits.moveDown": "x",
          "commits.moveUp": "x",
        },
      })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });
    const configFile = join(repo.root, ".diff4ac.json");

    expect(config.keybindings).toEqual({});
    expect(keyFor(config.keybindings, "commits.moveDown")).toBe("j");
    expect(keyFor(config.keybindings, "commits.moveUp")).toBe("k");
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === configFile &&
          diagnostic.field === "keybindings.commits.moveDown" &&
          diagnostic.message.includes("commits.moveUp"),
      ),
    ).toBe(true);
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === configFile &&
          diagnostic.field === "keybindings.commits.moveUp" &&
          diagnostic.message.includes("commits.moveDown"),
      ),
    ).toBe(true);
  });

  test("merges Agent patterns and reports invalid regexes with file and field", () => {
    const home = tempHome();
    const repo = fixture();

    home.writeGlobalConfig({
      agents: {
        "My Agent": {
          trailers: ["Co-Authored-By: My Agent"],
          authors: "^my-agent@example\\.com$",
        },
      },
    });
    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({
        agents: {
          "My Agent": {
            trailers: ["X-My-Agent: yes"],
          },
          Broken: {
            trailers: ["("],
          },
          Empty: {},
        },
      })}\n`,
    );

    const config = loadConfig({
      homeDir: home.path,
      repositoryRoot: repo.root,
    });
    const configFile = join(repo.root, ".diff4ac.json");

    expect(config.agents).toEqual([
      {
        name: "My Agent",
        trailers: ["Co-Authored-By: My Agent", "X-My-Agent: yes"],
        authors: ["^my-agent@example\\.com$"],
      },
    ]);
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === configFile &&
          diagnostic.field === "agents.Broken.trailers[0]" &&
          diagnostic.message.includes("invalid regular expression"),
      ),
    ).toBe(true);
    expect(
      config.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === configFile &&
          diagnostic.field === "agents.Empty" &&
          diagnostic.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  test("warns and falls back to auto-detection when the configured Base Branch is missing", async () => {
    const home = tempHome();
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");

    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({ baseBranch: "missing" })}\n`,
    );
    const configFile = join(repo.root, ".diff4ac.json");

    const running = await startServer({
      repoPath: repo.root,
      homeDir: home.path,
    });
    servers.push(running);

    expect(running.config.baseBranch).toBeNull();
    expect(running.config.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: configFile,
          field: "baseBranch",
          message: 'branch "missing" not found; using auto-detection',
        }),
      ]),
    );

    const configResponse = await fetch(
      `http://127.0.0.1:${running.port}/api/config`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    const served = (await configResponse.json()) as ConfigInfo;
    expect(served.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: configFile,
          field: "baseBranch",
          message: 'branch "missing" not found; using auto-detection',
        }),
      ]),
    );

    const branchesResponse = await fetch(
      `http://127.0.0.1:${running.port}/api/branches`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    const list = (await branchesResponse.json()) as BranchList;
    expect(list.baseBranch).toEqual({ name: "main", ref: "main" });
  });

  test("applies a Base Branch override and serves effective config to the SPA", async () => {
    const home = tempHome();
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    repo.git(["branch", "develop"]);

    repo.write(
      ".diff4ac.json",
      `${JSON.stringify({
        baseBranch: "develop",
        keybindings: { "branches.moveDown": "b" },
      })}\n`,
    );
    const configFile = join(repo.root, ".diff4ac.json");
    const configBefore = readFileSync(configFile, "utf8");

    const running = await startServer({
      repoPath: repo.root,
      homeDir: home.path,
    });
    servers.push(running);

    const configResponse = await fetch(
      `http://127.0.0.1:${running.port}/api/config`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    expect(configResponse.status).toBe(200);
    const config = (await configResponse.json()) as ConfigInfo;
    expect(config.baseBranch).toBe("develop");
    expect(config.keybindings).toEqual({ "branches.moveDown": "b" });
    expect(config.diagnostics).toEqual([]);

    const branchesResponse = await fetch(
      `http://127.0.0.1:${running.port}/api/branches`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    const list = (await branchesResponse.json()) as BranchList;
    expect(list.baseBranch).toEqual({
      name: "develop",
      ref: "refs/heads/develop",
    });

    expect(readFileSync(configFile, "utf8")).toBe(configBefore);
    expect(existsSync(join(repo.root, ".diff4ac"))).toBe(false);
  });

  test("uses the Base Branch override for branch Change Sets", async () => {
    const repo = fixture();
    repo.write("base.txt", "base\n");
    repo.commit("base");
    repo.git(["checkout", "-q", "-b", "develop"]);
    repo.write("develop.txt", "develop\n");
    repo.commit("develop work");
    repo.git(["checkout", "-q", "-b", "feature"]);
    repo.write("feature.txt", "feature\n");
    repo.commit("feature work");

    const changeSet = await buildBranchChangeSet(
      await GitGateway.open(repo.root),
      "feature",
      "develop",
    );

    expect(changeSet.selection.kind).toBe("branch");
    if (changeSet.selection.kind !== "branch") {
      throw new Error("expected a branch Selection");
    }
    expect(changeSet.selection.baseBranch.name).toBe("develop");
    expect(changeSet.files.map((file) => file.path)).toEqual(["feature.txt"]);
  });

  test("still starts with invalid config and exposes the diagnostics", async () => {
    const home = tempHome();
    const repo = fixture();
    repo.write("README.md", "hello\n");
    repo.commit("initial");
    home.writeGlobalConfig("{ broken");

    const running = await startServer({
      repoPath: repo.root,
      homeDir: home.path,
    });
    servers.push(running);

    expect(running.config.baseBranch).toBeNull();
    expect(running.config.keybindings).toEqual({});
    expect(running.config.diagnostics.length).toBeGreaterThan(0);

    const response = await fetch(
      `http://127.0.0.1:${running.port}/api/config`,
      { headers: { "x-diff4ac-token": running.token } },
    );
    expect(response.status).toBe(200);
  });
});
