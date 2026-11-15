import { changeSetTotals } from "./changeset/totals";
import { extensionOf } from "./paths";
import type {
  ChangeFile,
  ChangeSet,
  FilterInfo,
  FilterRequest,
} from "../shared/types";

export const DEFAULT_NOISE_PATTERNS: readonly string[] = [
  "**/*.lock",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/*.snap",
  "**/*.snap.md",
  "**/__snapshots__/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/node_modules/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
];

export interface FilterSettings extends FilterRequest {
  readonly noisePatterns: readonly string[];
}

export { extensionOf };

function globBody(pattern: string): string {
  if (pattern.startsWith("\\!")) {
    return pattern.slice(1);
  }
  if (pattern.startsWith("!")) {
    return pattern.slice(1);
  }
  return pattern;
}

export function isValidGlob(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (
    trimmed === "" ||
    /[\0\r\n]/.test(trimmed) ||
    trimmed.length > 1024
  ) {
    return false;
  }

  return globBody(trimmed) !== "";
}

type MatchResult = "positive" | "negative" | null;
type Matcher = (path: string) => MatchResult;

interface CompiledGlob {
  readonly glob: Bun.Glob;
  readonly basenameOnly: boolean;
  readonly negated: boolean;
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function compilePattern(rawPattern: string): CompiledGlob | null {
  const pattern = rawPattern.trim();
  if (!isValidGlob(pattern)) {
    return null;
  }

  const negated = !pattern.startsWith("\\!") && pattern.startsWith("!");
  let body = pattern.startsWith("\\!") ? pattern.slice(1) : pattern;
  if (negated) {
    body = body.slice(1);
  }

  const basenameOnly = !body.includes("/");
  const normalized = body.startsWith("/")
    ? body.replace(/^\/+/, "")
    : body;

  if (normalized === "") {
    return null;
  }

  try {
    return { glob: new Bun.Glob(normalized), basenameOnly, negated };
  } catch {
    return null;
  }
}

function compileMatchers(patterns: readonly string[]): Matcher {
  const globs = patterns
    .map(compilePattern)
    .filter((compiled): compiled is CompiledGlob => compiled !== null);

  return (path) => {
    let result: MatchResult = null;

    for (const compiled of globs) {
      const target = compiled.basenameOnly ? basenameOf(path) : path;
      try {
        if (compiled.glob.match(target)) {
          result = compiled.negated ? "negative" : "positive";
        }
      } catch {
        // Ignore a pattern that cannot be matched.
      }
    }

    return result;
  };
}


/** Whether a path matches the configured Noise patterns. */
export function isNoisePath(
  path: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return compileMatchers(patterns)(path) === "positive";
}

/** Whether a directory itself matches a Noise pattern such as a build folder. */
export function isNoiseDirectory(
  path: string,
  patterns: readonly string[],
): boolean {
  return isNoisePath(`${path.replace(/\/+$/, "")}/`, patterns);
}

function uniqueFiles(changeSet: ChangeSet): ChangeFile[] {
  const byPath = new Map<string, ChangeFile>();
  for (const file of changeSet.files) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

function compileVisibility(
  settings: FilterSettings,
): (path: string) => boolean {
  const disabled = new Set(
    settings.disabledExtensions.map((extension) => extension.toLowerCase()),
  );
  const include = compileMatchers(settings.includeGlobs);
  const exclude = compileMatchers(settings.excludeGlobs);
  const noise = compileMatchers(settings.noisePatterns);
  const hasIncludes = settings.includeGlobs.some(isValidGlob);

  return (path) => {
    if (disabled.has(extensionOf(path))) {
      return false;
    }
    if (hasIncludes && include(path) !== "positive") {
      return false;
    }
    if (exclude(path) === "positive") {
      return false;
    }
    if (settings.hideNoise && noise(path) === "positive") {
      return false;
    }
    return true;
  };
}

/** Whether a single file survives the request's Filters. */
export function isFileVisible(
  file: ChangeFile,
  settings: FilterSettings,
): boolean {
  return compileVisibility(settings)(file.path);
}

export function applyFilters(
  changeSet: ChangeSet,
  settings: FilterSettings,
): ChangeSet {
  const visiblePath = compileVisibility(settings);
  const visible = (file: ChangeFile): boolean => visiblePath(file.path);

  const hiddenPaths = new Set<string>();
  const keep = (file: ChangeFile): boolean => {
    if (visible(file)) {
      return true;
    }
    hiddenPaths.add(file.path);
    return false;
  };

  const availableExtensions = [
    ...new Set(uniqueFiles(changeSet).map((file) => extensionOf(file.path))),
  ].sort((left, right) => left.localeCompare(right));

  const disabled = new Set(
    settings.disabledExtensions.map((extension) => extension.toLowerCase()),
  );

  const filter: FilterInfo = {
    availableExtensions,
    hiddenFiles: hiddenPaths.size,
    disabledExtensions: [...disabled],
    includeGlobs: settings.includeGlobs,
    excludeGlobs: settings.excludeGlobs,
    hideNoise: settings.hideNoise,
  };

  if (changeSet.commitGroups) {
    const commitGroups = changeSet.commitGroups
      .map((group) => {
        const files = group.files.filter(keep);
        return {
          ...group,
          files,
          totals: changeSetTotals(files),
        };
      })
      .filter((group) => group.files.length > 0);
    const files = commitGroups.flatMap((group) => group.files);

    return {
      ...changeSet,
      files,
      totals: changeSetTotals(files),
      commitGroups,
      filter: { ...filter, hiddenFiles: hiddenPaths.size },
    };
  }

  const files = changeSet.files.filter(keep);
  return {
    ...changeSet,
    files,
    totals: changeSetTotals(files),
    filter: { ...filter, hiddenFiles: hiddenPaths.size },
  };
}
