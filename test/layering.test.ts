import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const LAYERS = ["shared", "src", "web"] as const;

type Layer = (typeof LAYERS)[number];

interface ImportReference {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

const FROM_PATTERN =
  /\b(import|export)\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
const DYNAMIC_PATTERN = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
const SIDE_EFFECT_PATTERN = /\bimport\s+["']([^"']+)["']/g;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

function layerOf(path: string): Layer | null {
  const rel = relative(ROOT, path);
  for (const layer of LAYERS) {
    if (rel === layer || rel.startsWith(`${layer}/`)) {
      return layer;
    }
  }
  return null;
}

function importsIn(path: string): ImportReference[] {
  const text = readFileSync(path, "utf8");
  const references: ImportReference[] = [];

  for (const match of text.matchAll(FROM_PATTERN)) {
    const specifier = match[3];
    if (specifier) {
      references.push({ specifier, typeOnly: match[2] !== undefined });
    }
  }
  for (const match of text.matchAll(DYNAMIC_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      references.push({ specifier, typeOnly: false });
    }
  }
  for (const match of text.matchAll(SIDE_EFFECT_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      references.push({ specifier, typeOnly: false });
    }
  }
  return references;
}

function resolves(path: string): boolean {
  if (existsSync(path)) {
    return true;
  }
  return [".ts", ".tsx", "/index.ts", "/index.tsx"].some((suffix) =>
    existsSync(`${path}${suffix}`),
  );
}

function allowedTargets(layer: Layer): readonly Layer[] {
  switch (layer) {
    case "shared":
      return ["shared"];
    case "src":
      return ["src", "shared"];
    case "web":
      return ["web", "shared"];
  }
}

describe("layering", () => {
  for (const layer of LAYERS) {
    test(`${layer}/ only imports ${allowedTargets(layer).join(" and ")}`, () => {
      const violations: string[] = [];
      const directory = join(ROOT, layer);
      if (!existsSync(directory)) {
        return;
      }

      for (const file of sourceFiles(directory)) {
        for (const { specifier, typeOnly } of importsIn(file)) {
          if (!specifier.startsWith(".")) {
            if (layer === "shared" && !typeOnly) {
              violations.push(
                `${relative(ROOT, file)} imports runtime package "${specifier}"`,
              );
            }
            continue;
          }

          const target = resolve(dirname(file), specifier);
          if (!resolves(target)) {
            violations.push(
              `${relative(ROOT, file)} imports missing "${specifier}"`,
            );
            continue;
          }

          const targetLayer = layerOf(target);
          if (
            targetLayer === null ||
            !allowedTargets(layer).includes(targetLayer)
          ) {
            violations.push(
              `${relative(ROOT, file)} imports ${targetLayer ?? "outside the repo"} "${specifier}"`,
            );
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }

  test("shared/ does not use Bun or Node APIs", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(join(ROOT, "shared"))) {
      for (const { specifier } of importsIn(file)) {
        if (
          specifier.startsWith("node:") ||
          specifier === "bun" ||
          specifier.startsWith("bun:")
        ) {
          violations.push(`${relative(ROOT, file)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("the removed shim and moved modules are gone", () => {
    expect(existsSync(join(ROOT, "web", "keymap.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "types.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "keymap.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "toolbar.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "time-windows.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "changeset", "selection.ts"))).toBe(
      false,
    );
    expect(existsSync(join(ROOT, "src", "diff", "rows.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "shared", "types.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "shared", "keymap.ts"))).toBe(true);
  });
});
