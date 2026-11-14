import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOISE_PATTERNS, isValidGlob } from "../filters";
import { KEYMAP, type KeybindingOverrides } from "../keymap";
import type {
  AgentPatternConfig,
  ConfigDiagnostic,
  ConfigInfo,
  Theme,
} from "../types";

export interface LoadConfigOptions {
  readonly repositoryRoot: string;
  readonly homeDir?: string;
}

interface ParsedSource {
  readonly baseBranch?: string;
  readonly keybindings: KeybindingOverrides;
  readonly agents: readonly AgentPatternConfig[];
  readonly noise?: readonly string[];
  readonly theme?: Theme;
  readonly diagnostics: readonly ConfigDiagnostic[];
}

const THEMES: readonly Theme[] = ["system", "light", "dark"];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme);
}

const NAMED_KEYS = new Set(["Enter", "Tab", "Escape"]);
const FUNCTION_KEY = /^F(?:[1-9]|1[0-2])$/;

export function globalConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, ".diff4ac", "config.json");
}

export function repositoryConfigPath(repositoryRoot: string): string {
  return join(repositoryRoot, ".diff4ac.json");
}

function isValidKey(value: string): boolean {
  if (NAMED_KEYS.has(value) || FUNCTION_KEY.test(value)) {
    return true;
  }
  return [...value].length === 1;
}

function emptySource(): ParsedSource {
  return { keybindings: {}, agents: [], diagnostics: [] };
}

function readRegexList(
  value: unknown,
  file: string,
  field: string,
  diagnostics: ConfigDiagnostic[],
): string[] {
  if (value === undefined) {
    return [];
  }

  const values =
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value
        : null;
  if (!values) {
    diagnostics.push({
      file,
      field,
      message: "must be a string or an array of regex strings",
    });
    return [];
  }

  const patterns: string[] = [];
  values.forEach((raw, index) => {
    if (typeof raw !== "string") {
      diagnostics.push({
        file,
        field: `${field}[${index}]`,
        message: "must be a regex string",
      });
      return;
    }

    try {
      new RegExp(raw, "i");
    } catch (error) {
      diagnostics.push({
        file,
        field: `${field}[${index}]`,
        message: `invalid regular expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    patterns.push(raw);
  });

  return patterns;
}

function mergeAgentPatterns(
  ...groups: readonly (readonly AgentPatternConfig[])[]
): AgentPatternConfig[] {
  const byName = new Map<
    string,
    { name: string; trailers: string[]; authors: string[] }
  >();

  for (const group of groups) {
    for (const pattern of group) {
      const existing = byName.get(pattern.name);
      if (existing) {
        existing.trailers.push(...pattern.trailers);
        existing.authors.push(...pattern.authors);
      } else {
        byName.set(pattern.name, {
          name: pattern.name,
          trailers: [...pattern.trailers],
          authors: [...pattern.authors],
        });
      }
    }
  }

  return [...byName.values()];
}

function readSource(file: string): ParsedSource {
  if (!existsSync(file)) {
    return emptySource();
  }

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    return {
      keybindings: {},
      agents: [],
      diagnostics: [
        {
          file,
          field: "(file)",
          message: `could not read file: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      keybindings: {},
      agents: [],
      diagnostics: [
        {
          file,
          field: "(file)",
          message: `invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return {
      keybindings: {},
      agents: [],
      diagnostics: [
        {
          file,
          field: "(file)",
          message: "must be a JSON object",
        },
      ],
    };
  }

  const record = parsed as Record<string, unknown>;
  const diagnostics: ConfigDiagnostic[] = [];
  const keybindings: Record<string, string> = {};
  let baseBranch: string | undefined;
  let noise: string[] | undefined;
  let theme: Theme | undefined;

  if ("theme" in record) {
    const value = record.theme;
    if (!isTheme(value)) {
      diagnostics.push({
        file,
        field: "theme",
        message: 'must be "system", "light" or "dark"',
      });
    } else {
      theme = value;
    }
  }

  if ("baseBranch" in record) {
    const value = record.baseBranch;
    if (typeof value !== "string" || value.trim() === "") {
      diagnostics.push({
        file,
        field: "baseBranch",
        message: "must be a non-empty branch name",
      });
    } else {
      baseBranch = value.trim();
    }
  }

  if ("noise" in record) {
    const value = record.noise;
    if (
      !Array.isArray(value) ||
      !value.every(
        (pattern) =>
          typeof pattern === "string" && isValidGlob(pattern.trim()),
      )
    ) {
      diagnostics.push({
        file,
        field: "noise",
        message: "must be an array of glob patterns",
      });
    } else {
      noise = [
        ...new Set(value.map((pattern: string) => pattern.trim())),
      ];
    }
  }

  if ("keybindings" in record) {
    const value = record.keybindings;
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      diagnostics.push({
        file,
        field: "keybindings",
        message: "must be an object mapping binding ids to keys",
      });
    } else {
      for (const [id, key] of Object.entries(value)) {
        if (!KEYMAP.some((binding) => binding.id === id)) {
          diagnostics.push({
            file,
            field: `keybindings.${id}`,
            message: `unknown keybinding "${id}"`,
          });
          continue;
        }
        if (typeof key !== "string" || !isValidKey(key)) {
          diagnostics.push({
            file,
            field: `keybindings.${id}`,
            message: "must be a single key or Enter, Tab, Escape, F1–F12",
          });
          continue;
        }
        keybindings[id] = key;
      }
    }
  }

  const agents: AgentPatternConfig[] = [];
  if ("agents" in record) {
    const value = record.agents;
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      diagnostics.push({
        file,
        field: "agents",
        message: "must be an object mapping Agent names to patterns",
      });
    } else {
      for (const [rawName, entry] of Object.entries(value)) {
        const name = rawName.trim();
        if (!name) {
          diagnostics.push({
            file,
            field: "agents",
            message: "Agent name must be non-empty",
          });
          continue;
        }

        if (
          entry === null ||
          typeof entry !== "object" ||
          Array.isArray(entry)
        ) {
          diagnostics.push({
            file,
            field: `agents.${name}`,
            message: "must be an object with trailers and/or authors",
          });
          continue;
        }

        const patterns = entry as Record<string, unknown>;
        const trailers = readRegexList(
          patterns.trailers,
          file,
          `agents.${name}.trailers`,
          diagnostics,
        );
        const authors = readRegexList(
          patterns.authors,
          file,
          `agents.${name}.authors`,
          diagnostics,
        );

        if (trailers.length === 0 && authors.length === 0) {
          diagnostics.push({
            file,
            field: `agents.${name}`,
            message: "must define at least one trailer or author pattern",
          });
          continue;
        }

        agents.push({ name, trailers, authors });
      }
    }
  }

  return { baseBranch, keybindings, agents, noise, theme, diagnostics };
}

function scopesConflict(
  left: { readonly panel: string; readonly id: string },
  right: { readonly panel: string; readonly id: string },
): boolean {
  if (left.id === right.id) {
    return false;
  }
  if (left.panel === right.panel) {
    return true;
  }
  return left.panel === "global" || right.panel === "global";
}

function resolveKeybindingConflicts(
  overrides: KeybindingOverrides,
  sources: ReadonlyMap<string, string>,
): {
  readonly keybindings: KeybindingOverrides;
  readonly diagnostics: readonly ConfigDiagnostic[];
} {
  const byId = new Map(KEYMAP.map((binding) => [binding.id, binding] as const));
  const intended = new Map(
    KEYMAP.map((binding) => [binding.id, binding.key] as const),
  );
  for (const [id, key] of Object.entries(overrides)) {
    if (byId.has(id)) {
      intended.set(id, key);
    }
  }

  const dropped = new Set<string>();
  const diagnostics: ConfigDiagnostic[] = [];
  const overrideIds = Object.keys(overrides).filter((id) => byId.has(id));

  let changed = true;
  while (changed) {
    changed = false;

    for (const id of overrideIds) {
      if (dropped.has(id)) {
        continue;
      }

      const binding = byId.get(id);
      if (!binding) {
        continue;
      }
      const key = intended.get(id);
      if (key === undefined || key === binding.key) {
        continue;
      }

      const conflicts = KEYMAP.filter(
        (other) =>
          other.id !== id &&
          !dropped.has(other.id) &&
          intended.get(other.id) === key &&
          scopesConflict(binding, other),
      );
      if (conflicts.length === 0) {
        continue;
      }

      const group = [id, ...conflicts.map((other) => other.id)];
      const overriddenGroup = group.filter((memberId) => {
        const member = byId.get(memberId);
        return (
          member !== undefined &&
          overrideIds.includes(memberId) &&
          !dropped.has(memberId) &&
          intended.get(memberId) !== member.key
        );
      });

      for (const memberId of overriddenGroup) {
        const member = byId.get(memberId);
        if (!member) {
          continue;
        }
        const conflictingId =
          group.find(
            (otherId) => otherId !== memberId && !overriddenGroup.includes(otherId),
          ) ??
          group.find((otherId) => otherId !== memberId) ??
          "";
        dropped.add(memberId);
        intended.set(memberId, member.key);
        diagnostics.push({
          file: sources.get(memberId) ?? "",
          field: `keybindings.${memberId}`,
          message: `key "${key}" conflicts with binding "${conflictingId}"; ignoring override`,
        });
      }
      changed = true;
    }
  }

  const accepted: Record<string, string> = {};
  for (const [id, key] of Object.entries(overrides)) {
    if (byId.has(id) && !dropped.has(id)) {
      accepted[id] = key;
    }
  }

  return { keybindings: accepted, diagnostics };
}

export function loadConfig(options: LoadConfigOptions): ConfigInfo {
  const homeDir = options.homeDir ?? homedir();
  const globalPath = globalConfigPath(homeDir);
  const repositoryPath = repositoryConfigPath(options.repositoryRoot);

  const globalSource = readSource(globalPath);
  const repositorySource = readSource(repositoryPath);

  const baseBranchFile =
    repositorySource.baseBranch !== undefined
      ? repositoryPath
      : globalSource.baseBranch !== undefined
        ? globalPath
        : null;

  const overrideSources = new Map<string, string>();
  for (const id of Object.keys(globalSource.keybindings)) {
    overrideSources.set(id, globalPath);
  }
  for (const id of Object.keys(repositorySource.keybindings)) {
    overrideSources.set(id, repositoryPath);
  }

  const conflicts = resolveKeybindingConflicts(
    {
      ...globalSource.keybindings,
      ...repositorySource.keybindings,
    },
    overrideSources,
  );

  return {
    baseBranch:
      repositorySource.baseBranch ?? globalSource.baseBranch ?? null,
    ...(baseBranchFile ? { baseBranchFile } : {}),
    keybindings: conflicts.keybindings,
    agents: mergeAgentPatterns(globalSource.agents, repositorySource.agents),
    noise:
      repositorySource.noise ??
      globalSource.noise ??
      DEFAULT_NOISE_PATTERNS,
    theme: repositorySource.theme ?? globalSource.theme ?? "system",
    diagnostics: [
      ...globalSource.diagnostics,
      ...repositorySource.diagnostics,
      ...conflicts.diagnostics,
    ],
  };
}
