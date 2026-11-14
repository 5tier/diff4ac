import { afterEach, describe, expect, test } from "bun:test";
import {
  BUILT_IN_AGENT_PATTERNS,
  classifyAgent,
  compileAgentPatterns,
} from "../src/agents";
import { GitGateway } from "../src/git/gateway";
import { listCommits } from "../src/repository/commits";
import { createFixtureRepo, type FixtureRepo } from "./helpers/fixture";

const repos: FixtureRepo[] = [];

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.dispose();
  }
});

const patterns = compileAgentPatterns([
  ...BUILT_IN_AGENT_PATTERNS,
  {
    name: "Helper",
    trailers: ["Co-Authored-By:\\s*Helper"],
    authors: ["^helper@example\\.com$"],
  },
]);

describe("Agent Classifier", () => {
  test("recognises built-in trailer and author patterns", () => {
    expect(
      classifyAgent(
        {
          authorName: "Ruwen",
          authorEmail: "ruwen@example.com",
          trailers: [
            "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
          ],
        },
        patterns,
      ),
    ).toBe("Claude Code");

    expect(
      classifyAgent(
        {
          authorName: "Codex",
          authorEmail: "codex@openai.com",
          trailers: [],
        },
        patterns,
      ),
    ).toBe("Codex");

    expect(
      classifyAgent(
        {
          authorName: "GitHub Copilot",
          authorEmail: "copilot@github.com",
          trailers: [],
        },
        patterns,
      ),
    ).toBe("Copilot");
  });

  test("recognises custom trailer and author regexes", () => {
    expect(
      classifyAgent(
        {
          authorName: "Ruwen",
          authorEmail: "ruwen@example.com",
          trailers: ["Co-Authored-By: Helper <helper@example.com>"],
        },
        patterns,
      ),
    ).toBe("Helper");

    expect(
      classifyAgent(
        {
          authorName: "Helper Bot",
          authorEmail: "helper@example.com",
          trailers: [],
        },
        patterns,
      ),
    ).toBe("Helper");
  });

  test("leaves human commits unclassified", () => {
    expect(
      classifyAgent(
        {
          authorName: "Ruwen Jin",
          authorEmail: "ruwen@example.com",
          trailers: ["Reviewed-By: Ruwen Jin <ruwen@example.com>"],
        },
        patterns,
      ),
    ).toBeNull();
  });
});

describe("Agent Commit detection from git trailers", () => {
  test("classifies commits while listing real git history", async () => {
    const repo = fixture();
    repo.write("one.txt", "one\n");
    repo.commit("human");

    repo.write("two.txt", "two\n");
    repo.commit("claude", {
      trailers: [
        "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      ],
    });

    repo.write("three.txt", "three\n");
    repo.commit("copilot", {
      author: { name: "GitHub Copilot", email: "copilot@github.com" },
    });

    repo.write("four.txt", "four\n");
    repo.commit("helper", {
      trailers: ["Co-Authored-By: Helper <helper@example.com>"],
    });

    repo.write("five.txt", "five\n");
    repo.commit("human again");

    const list = await listCommits(await GitGateway.open(repo.root), {
      agentPatterns: patterns,
    });

    expect(
      list.commits.map((commit) => [commit.message, commit.agent]),
    ).toEqual([
      ["human again", null],
      ["helper", "Helper"],
      ["copilot", "Copilot"],
      ["claude", "Claude Code"],
      ["human", null],
    ]);
  });
});
