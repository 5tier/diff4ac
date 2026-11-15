import { describe, expect, test } from "bun:test";
import { isSafeRelativePath, isValidBranchName } from "../src/paths";

describe("safe relative paths", () => {
  test("accepts ordinary paths, spaces and colons", () => {
    for (const path of [
      "src/app.ts",
      "src/a b.txt",
      "src/a:b.txt",
      "-leading-dash.txt",
      "üñï/file.txt",
      ".gitignore",
    ]) {
      expect(isSafeRelativePath(path), path).toBe(true);
    }
  });

  test("rejects absolute, traversal, backslash and control characters", () => {
    for (const path of [
      "",
      "/etc/passwd",
      "C:\\windows\\x",
      "src\\app.ts",
      "../escape",
      "src/../escape",
      "src/./x",
      "src/\nfile",
      "src/\rfile",
      "src/\x7ffile",
      "src/\x01file",
    ]) {
      expect(isSafeRelativePath(path), JSON.stringify(path)).toBe(false);
    }
  });
});

describe("branch names", () => {
  test("accepts conservative valid branch names", () => {
    for (const name of [
      "main",
      "feature/x",
      "release-1.0",
      "agent/feature-x",
      "üñï",
    ]) {
      expect(isValidBranchName(name), name).toBe(true);
    }
  });

  test("rejects git-unsafe and diff4ac-unsafe names", () => {
    for (const name of [
      "",
      "-x",
      "/x",
      "x/",
      "x.",
      "x.lock",
      "a..b",
      "a@{b}",
      "a b",
      "a\tb",
      "a\nb",
      "a~b",
      "a^b",
      "a:b",
      "a?b",
      "a*b",
      "a[b",
      "a\\b",
      "a//b",
    ]) {
      expect(isValidBranchName(name), JSON.stringify(name)).toBe(false);
    }
  });
});
