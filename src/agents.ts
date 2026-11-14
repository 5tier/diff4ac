import type { AgentPatternConfig } from "./types";

export interface CompiledAgentPattern {
  readonly name: string;
  readonly trailers: readonly RegExp[];
  readonly authors: readonly RegExp[];
}

export interface AgentCommitInput {
  readonly authorName: string;
  readonly authorEmail: string;
  readonly trailers: readonly string[];
}

export const BUILT_IN_AGENT_PATTERNS: readonly AgentPatternConfig[] = [
  {
    name: "Claude Code",
    trailers: ["Co-Authored-By:\\s*Claude"],
    authors: ["^Claude(?: Code)?$", "noreply@anthropic\\.com$"],
  },
  {
    name: "Codex",
    trailers: ["Co-Authored-By:\\s*Codex", "Co-Authored-By:.*openai\\.com"],
    authors: ["^Codex$", "codex@openai\\.com$"],
  },
  {
    name: "Copilot",
    trailers: ["Co-Authored-By:\\s*(?:GitHub )?Copilot"],
    authors: ["^(?:GitHub )?Copilot$", "copilot@github\\.com$"],
  },
];

export function compileAgentRegex(source: string): RegExp {
  return new RegExp(source, "i");
}

export function compileAgentPatterns(
  sources: readonly AgentPatternConfig[],
): CompiledAgentPattern[] {
  const patterns: CompiledAgentPattern[] = [];

  for (const source of sources) {
    const trailers: RegExp[] = [];
    const authors: RegExp[] = [];

    for (const trailer of source.trailers) {
      try {
        trailers.push(compileAgentRegex(trailer));
      } catch {
        // Config loading reports invalid regexes; built-ins are valid.
      }
    }
    for (const author of source.authors) {
      try {
        authors.push(compileAgentRegex(author));
      } catch {
        // Config loading reports invalid regexes; built-ins are valid.
      }
    }

    if (trailers.length > 0 || authors.length > 0) {
      patterns.push({ name: source.name, trailers, authors });
    }
  }

  return patterns;
}

export const DEFAULT_AGENT_PATTERNS: readonly CompiledAgentPattern[] =
  compileAgentPatterns(BUILT_IN_AGENT_PATTERNS);

export function classifyAgent(
  input: AgentCommitInput,
  patterns: readonly CompiledAgentPattern[] = DEFAULT_AGENT_PATTERNS,
): string | null {
  const author = `${input.authorName} <${input.authorEmail}>`;

  for (const pattern of patterns) {
    if (
      pattern.trailers.some((trailer) =>
        input.trailers.some((line) => trailer.test(line)),
      )
    ) {
      return pattern.name;
    }

    if (
      pattern.authors.some(
        (authorPattern) =>
          authorPattern.test(input.authorName) ||
          authorPattern.test(input.authorEmail) ||
          authorPattern.test(author),
      )
    ) {
      return pattern.name;
    }
  }

  return null;
}
