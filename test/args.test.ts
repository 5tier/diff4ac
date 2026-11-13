import { describe, expect, test } from "bun:test";
import { parseArgs, UsageError } from "../src/args";

describe("CLI arguments", () => {
  test("defaults to the current directory and opens the browser", () => {
    expect(parseArgs([])).toEqual({
      path: ".",
      port: undefined,
      open: true,
      help: false,
      version: false,
    });
  });

  test("accepts a path, --port and --no-open", () => {
    expect(parseArgs(["../other-repo", "--port", "4321", "--no-open"])).toEqual({
      path: "../other-repo",
      port: 4321,
      open: false,
      help: false,
      version: false,
    });
    expect(parseArgs(["--port=4321"]).port).toBe(4321);
  });

  test("rejects invalid ports and unknown options", () => {
    expect(() => parseArgs(["--port", "nope"])).toThrow(UsageError);
    expect(() => parseArgs(["--port", "70000"])).toThrow(UsageError);
    expect(() => parseArgs(["--wat"])).toThrow(UsageError);
  });

  test("only accepts one path", () => {
    expect(() => parseArgs(["one", "two"])).toThrow(UsageError);
  });
});
