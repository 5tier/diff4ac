import { changeSetTotals } from "./changeset/files";
import type {
  ChangeFile,
  ChangeSet,
  FilterInfo,
  FilterRequest,
} from "./types";

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

export function extensionOf(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot).toLowerCase();
}

export function isValidGlob(pattern: string): boolean {
  return (
    pattern.trim() !== "" &&
    !/[\0\r\n]/.test(pattern) &&
    pattern.length <= 1024
  );
}

type Matcher = (path: string) => boolean;

interface CompiledGlob {
  readonly glob: Bun.Glob;
  readonly basenameOnly: boolean;
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

  const basenameOnly = !pattern.includes("/");
  const normalized = pattern.startsWith("/")
    ? pattern.replace(/^\/+/, "")
    : pattern;

  if (normalized === "") {
    return null;
  }

  try {
    return { glob: new Bun.Glob(normalized), basenameOnly };
  } catch {
    return null;
  }
}

function compileMatchers(patterns: readonly string[]): Matcher {
  const globs = patterns
    .map(compilePattern)
    .filter((compiled): compiled is CompiledGlob => compiled !== null);

  return (path) =>
    globs.some((compiled) => {
      const target = compiled.basenameOnly ? basenameOf(path) : path;
      try {
        return compiled.glob.match(target);
      } catch {
        return false;
      }
    });
}


function uniqueFiles(changeSet: ChangeSet): ChangeFile[] {
  const byPath = new Map<string, ChangeFile>();
  for (const file of changeSet.files) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

export function applyFilters(
  changeSet: ChangeSet,
  settings: FilterSettings,
): ChangeSet {
  const disabled = new Set(
    settings.disabledExtensions.map((extension) => extension.toLowerCase()),
  );
  const include = compileMatchers(settings.includeGlobs);
  const exclude = compileMatchers(settings.excludeGlobs);
  const noise = compileMatchers(settings.noisePatterns);
  const hasIncludes = settings.includeGlobs.some(isValidGlob);

  const visible = (file: ChangeFile): boolean => {
    if (disabled.has(extensionOf(file.path))) {
      return false;
    }
    if (hasIncludes && !include(file.path)) {
      return false;
    }
    if (exclude(file.path)) {
      return false;
    }
    if (settings.hideNoise && noise(file.path)) {
      return false;
    }
    return true;
  };

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
