import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEYMAP } from "../shared/keymap";

const ROOT = join(import.meta.dir, "..");

function readmeKeys(): string[] {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const section =
    /<!-- keys:start -->([\s\S]*?)<!-- keys:end -->/.exec(readme)?.[1] ?? "";
  const keys: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) {
      continue;
    }
    const firstCell = line.split("|")[1] ?? "";
    if (firstCell.includes("---")) {
      continue;
    }
    for (const match of firstCell.matchAll(/`([^`]+)`/g)) {
      const key = match[1];
      if (key) {
        keys.push(key);
      }
    }
  }
  return keys;
}

/** README spelling -> the key string used by shared/keymap.ts. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  Space: " ",
  Esc: "Escape",
};

describe("README key table", () => {
  test("lists the main keys from the keymap", () => {
    const keys = readmeKeys();
    expect(keys.length).toBeGreaterThan(10);
    const known = new Set(KEYMAP.map((binding) => binding.key));
    expect(
      keys
        .map((key) => KEY_ALIASES[key] ?? key)
        .filter((key) => !known.has(key)),
    ).toEqual([]);
  });
});
