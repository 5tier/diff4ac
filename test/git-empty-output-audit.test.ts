import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

/** Index of the `close` that balances `open` at `start`, skipping strings. */
function balancedEnd(
  text: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index++;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === quote) {
          break;
        }
        index++;
      }
      continue;
    }
    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** All plain string literals in source order (enough for git argument lists). */
function stringLiterals(text: string): string[] {
  const literals: string[] = [];
  for (let index = 0; index < text.length; index++) {
    const quote = text[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      continue;
    }
    const start = index + 1;
    index++;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === quote) {
        break;
      }
      index++;
    }
    literals.push(text.slice(start, index));
  }
  return literals;
}

/**
 * Subcommands whose exit-0 output is never legitimately empty. Kept narrow:
 * diff/log-without--1/ls-files/ls-tree/cat-file -p may all be empty.
 */
function emptyImpossible(args: readonly string[]): boolean {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "rev-parse":
    case "symbolic-ref":
    case "merge-base":
      return true;
    case "worktree":
      return rest[0] === "list";
    case "cat-file":
      return rest.includes("-s");
    case "log":
      return rest.includes("-1");
    default:
      return false;
  }
}

describe("git empty-output audit", () => {
  test("retryOnEmpty is gone", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (readFileSync(file, "utf8").includes("retryOnEmpty")) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no impossible-empty call site passes emptyOk", () => {
    const violations: string[] = [];
    let impossibleCalls = 0;
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\.(?:run|text)\(/g)) {
        const callOpen = (match.index ?? 0) + match[0].length - 1;
        const callEnd = balancedEnd(text, callOpen, "(", ")");
        if (callEnd === -1) {
          continue;
        }
        const call = text.slice(callOpen + 1, callEnd);
        const arrayStart = call.indexOf("[");
        if (arrayStart === -1 || call.slice(0, arrayStart).trim() !== "") {
          continue;
        }
        const arrayEnd = balancedEnd(call, arrayStart, "[", "]");
        if (arrayEnd === -1) {
          continue;
        }
        const args = stringLiterals(call.slice(arrayStart, arrayEnd + 1));
        if (args.length === 0 || !emptyImpossible(args)) {
          continue;
        }
        impossibleCalls++;
        if (/\bemptyOk\s*:\s*true\b/.test(call.slice(arrayEnd + 1))) {
          const line = text.slice(0, match.index).split("\n").length;
          violations.push(
            `${relative(ROOT, file)}:${line} ${args.slice(0, 3).join(" ")} passes emptyOk`,
          );
        }
      }
    }
    expect(impossibleCalls).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
