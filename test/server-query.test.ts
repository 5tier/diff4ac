import { describe, expect, test } from "bun:test";
import {
  isValidCommitHash,
  isValidContentRev,
  parseBranchScope,
  parseChangeViewMode,
  parseCommitHash,
  parseCommitScope,
  parseCommitSkip,
  parseCommitsScope,
  parseFileContentRequest,
  parseFileDiffRequest,
  parseFilterSettings,
  parseScope,
  parseSnapshotFileRequest,
  parseSnapshotPathsRequest,
  parseSnapshotSide,
  parseSnapshotTreeRequest,
  parseTimeWindowMode,
  parseTimeWindowRequest,
  parseTimeWindowScope,
  wantsFullContext,
  type ParseResult,
} from "../src/server/query";

const BASE = "http://127.0.0.1/api";

function url(query: string): URL {
  return new URL(`${BASE}?${query}`);
}

function expectFailure<T>(
  result: ParseResult<T>,
  message: string,
  status = 400,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.status).toBe(status);
  expect(result.message).toBe(message);
}

function expectValue<T>(result: ParseResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.value;
}

describe("commit hash parsing", () => {
  test("accepts 4 to 64 hex characters", () => {
    expect(expectValue(parseCommitHash("abcd"))).toBe("abcd");
    expect(expectValue(parseCommitHash("A1B2"))).toBe("A1B2");
    expect(expectValue(parseCommitHash("a".repeat(64)))).toBe("a".repeat(64));
    expect(isValidCommitHash("abcd")).toBe(true);
    expect(isValidContentRev("index")).toBe(true);
    expect(isValidContentRev("worktree")).toBe(true);
    expect(isValidContentRev("abcd")).toBe(true);
  });

  test("rejects missing, short, long and non-hex values", () => {
    for (const value of [null, "", "abc", "a".repeat(65), "zzzz", "abc deg"]) {
      expectFailure(
        parseCommitHash(value),
        "Bad request: a commit hash is required",
      );
    }
    expect(isValidContentRev("HEAD")).toBe(false);
    expect(isValidContentRev(null)).toBe(false);
  });
});

describe("Change View mode parsing", () => {
  test("defaults to net and accepts net and stack", () => {
    expect(expectValue(parseChangeViewMode(null))).toBe("net");
    expect(expectValue(parseChangeViewMode("net"))).toBe("net");
    expect(expectValue(parseChangeViewMode("stack"))).toBe("stack");
  });

  test("rejects every other value", () => {
    for (const value of ["", "auto", "STACK", "side-by-side"]) {
      expectFailure(
        parseChangeViewMode(value),
        "Bad request: commit hashes and a mode of net or stack are required",
      );
    }
  });
});

describe("scope parsing", () => {
  test("parses a commit scope", () => {
    expect(expectValue(parseCommitScope(url("hash=abcd")))).toEqual({
      kind: "commit",
      hash: "abcd",
    });
    expectFailure(
      parseCommitScope(url("")),
      "Bad request: a commit hash is required",
    );
    expectFailure(
      parseCommitScope(url("hash=nope")),
      "Bad request: a commit hash is required",
    );
  });

  test("parses a commit-set scope", () => {
    expect(
      expectValue(parseCommitsScope(url("hashes=abcd,ef01&mode=stack"))),
    ).toEqual({
      kind: "commits",
      hashes: ["abcd", "ef01"],
      mode: "stack",
    });
    expect(expectValue(parseCommitsScope(url("hashes=abcd")))).toMatchObject({
      mode: "net",
    });

    const message =
      "Bad request: commit hashes and a mode of net or stack are required";
    for (const query of [
      "mode=net",
      "hashes=&mode=net",
      "hashes=abcd,nope&mode=net",
      "hashes=abcd&mode=auto",
    ]) {
      expectFailure(parseCommitsScope(url(query)), message);
    }
  });

  test("parses a branch scope", () => {
    expect(expectValue(parseBranchScope(url("name=main")))).toEqual({
      kind: "branch",
      name: "main",
    });
    expectFailure(
      parseBranchScope(url("name=")),
      "Bad request: a branch name is required",
    );
    expectFailure(
      parseBranchScope(url("")),
      "Bad request: a branch name is required",
    );
  });

  test("dispatches parseScope on the selection parameter", () => {
    expect(expectValue(parseScope(url("selection=pending")))).toEqual({
      kind: "pending",
    });
    expect(expectValue(parseScope(url("selection=commit&hash=abcd")))).toEqual({
      kind: "commit",
      hash: "abcd",
    });
    expect(
      expectValue(parseScope(url("selection=commits&hashes=abcd&mode=stack"))),
    ).toEqual({ kind: "commits", hashes: ["abcd"], mode: "stack" });
    expect(
      expectValue(parseScope(url("selection=branch&name=main"))),
    ).toEqual({ kind: "branch", name: "main" });

    expectFailure(
      parseScope(url("")),
      "Bad request: a Selection is required",
    );
    expectFailure(
      parseScope(url("selection=wat")),
      "Bad request: unknown Selection",
    );
    expectFailure(
      parseScope(url("selection=commit")),
      "Bad request: a commit hash is required",
    );
    expectFailure(
      parseScope(url("selection=commits")),
      "Bad request: commit hashes and a mode of net or stack are required",
    );
    expectFailure(
      parseScope(url("selection=time-window")),
      "Bad request: start, end and a preset are required",
    );
    expectFailure(
      parseScope(url("selection=branch")),
      "Bad request: a branch name is required",
    );
  });
});

describe("Time Window parsing", () => {
  const window =
    "start=2024-01-01T00:00:00.000Z&end=2024-01-02T00:00:00.000Z&preset=custom";

  test("parses start, end and preset into ISO instants", () => {
    const parsed = expectValue(parseTimeWindowRequest(url(window)));
    expect(parsed.preset).toBe("custom");
    expect(parsed.start).toBe("2024-01-01T00:00:00.000Z");
    expect(parsed.end).toBe("2024-01-02T00:00:00.000Z");
    expect(typeof parsed.label).toBe("string");
  });

  test("rejects missing, malformed and inverted windows", () => {
    const message = "Bad request: start, end and a preset are required";
    for (const query of [
      "",
      "start=2024-01-01T00:00:00.000Z&end=2024-01-02T00:00:00.000Z",
      "start=nope&end=2024-01-02T00:00:00.000Z&preset=custom",
      "start=2024-01-02T00:00:00.000Z&end=2024-01-01T00:00:00.000Z&preset=custom",
      "start=2024-01-01T00:00:00.000Z&end=2024-01-02T00:00:00.000Z&preset=nope",
    ]) {
      expectFailure(parseTimeWindowRequest(url(query)), message);
    }
  });

  test("defaults the mode to auto and accepts auto, net and stack", () => {
    expect(expectValue(parseTimeWindowMode(null))).toBe("auto");
    expect(expectValue(parseTimeWindowMode("auto"))).toBe("auto");
    expect(expectValue(parseTimeWindowMode("net"))).toBe("net");
    expect(expectValue(parseTimeWindowMode("stack"))).toBe("stack");
    for (const value of ["", "custom", "STACK"]) {
      expectFailure(
        parseTimeWindowMode(value),
        "Bad request: mode must be auto, net or stack",
      );
    }
  });

  test("parses a Time Window scope with an optional agent", () => {
    expect(expectValue(parseTimeWindowScope(url(window)))).toMatchObject({
      kind: "time-window",
      mode: "auto",
    });
    const withAgent = expectValue(
      parseTimeWindowScope(url(`${window}&mode=stack&agent=Claude`)),
    );
    expect(withAgent).toMatchObject({ mode: "stack", agent: "Claude" });
    expect(
      expectValue(parseTimeWindowScope(url(`${window}&agent=`))),
    ).not.toHaveProperty("agent");

    expectFailure(
      parseTimeWindowScope(url("mode=stack")),
      "Bad request: start, end and a preset are required",
    );
    expectFailure(
      parseTimeWindowScope(url(`${window}&mode=nope`)),
      "Bad request: mode must be auto, net or stack",
    );
  });
});

describe("Commits paging parsing", () => {
  test("defaults to zero and accepts non-negative integers", () => {
    expect(expectValue(parseCommitSkip(url("")))).toBe(0);
    expect(expectValue(parseCommitSkip(url("skip=0")))).toBe(0);
    expect(expectValue(parseCommitSkip(url("skip=12")))).toBe(12);
    expect(expectValue(parseCommitSkip(url("skip=500")))).toBe(500);
  });

  test("rejects negative, fractional, empty and oversized skips", () => {
    for (const query of [
      "skip=-1",
      "skip=1.5",
      "skip=",
      "skip=abc",
      "skip=%201",
      "skip=99999999999999999999",
    ]) {
      expectFailure(
        parseCommitSkip(url(query)),
        "Bad request: skip must be a non-negative integer",
      );
    }
  });
});

describe("Snapshot query parsing", () => {
  test("requires side=after or side=before", () => {
    expect(expectValue(parseSnapshotSide(url("side=after")))).toBe("after");
    expect(expectValue(parseSnapshotSide(url("side=before")))).toBe("before");
    for (const query of ["", "side=nope", "side="]) {
      expectFailure(
        parseSnapshotSide(url(query)),
        "Bad request: side must be after or before",
      );
    }
  });

  test("parses a tree request with a safe relative dir", () => {
    expect(
      expectValue(
        parseSnapshotTreeRequest(
          url("selection=pending&side=after&dir=src%2Fcomponents%2F"),
        ),
      ),
    ).toMatchObject({
      scope: { kind: "pending" },
      side: "after",
      dir: "src/components",
    });
    expect(
      expectValue(parseSnapshotTreeRequest(url("selection=pending&side=after"))),
    ).toMatchObject({ dir: "" });

    for (const dir of ["..%2Fescape", "%2Fetc", "src%2F..%2F..%2Fx"]) {
      expectFailure(
        parseSnapshotTreeRequest(
          url(`selection=pending&side=after&dir=${dir}`),
        ),
        "Bad request: a safe directory path is required",
      );
    }
  });

  test("parses file and raw requests, including full", () => {
    const base = "selection=pending&side=after&path=src%2Fapp.ts";
    expect(expectValue(parseSnapshotFileRequest(url(base)))).toMatchObject({
      path: "src/app.ts",
      full: false,
    });
    expect(
      expectValue(parseSnapshotFileRequest(url(`${base}&full=1`))),
    ).toMatchObject({ full: true });
    expectFailure(
      parseSnapshotFileRequest(url(`${base}&full=yes`)),
      "Bad request: full must be 1",
    );
    for (const path of ["", "..%2Fescape", "%2Fetc%2Fpasswd"]) {
      expectFailure(
        parseSnapshotFileRequest(
          url(`selection=pending&side=after&path=${path}`),
        ),
        "Bad request: a safe file path is required",
      );
    }
  });

  test("parses path search with q and a bounded limit", () => {
    expect(
      expectValue(
        parseSnapshotPathsRequest(
          url("selection=pending&side=after&q=app&limit=10"),
        ),
      ),
    ).toMatchObject({ query: "app", limit: 10 });
    expect(
      expectValue(parseSnapshotPathsRequest(url("selection=pending&side=after"))),
    ).toMatchObject({ query: "", limit: 50 });

    expectFailure(
      parseSnapshotPathsRequest(
        url(`selection=pending&side=after&q=${"x".repeat(257)}`),
      ),
      "Bad request: q must be at most 256 characters",
    );
    for (const limit of ["0", "201", "abc", "1.5", ""]) {
      expectFailure(
        parseSnapshotPathsRequest(
          url(`selection=pending&side=after&limit=${limit}`),
        ),
        "Bad request: limit must be between 1 and 200",
      );
    }
  });
});

describe("Filters and context parsing", () => {
  test("parses empty Filters with noise on", () => {
    expect(expectValue(parseFilterSettings(url(""), ["**/*.lock"]))).toEqual({
      disabledExtensions: [],
      includeGlobs: [],
      excludeGlobs: [],
      hideNoise: true,
      noisePatterns: ["**/*.lock"],
    });
  });

  test("normalizes extensions and collects globs", () => {
    const filters = expectValue(
      parseFilterSettings(
        url(
          "ext=.TS&ext=%20.MD%20&include=src%2F**&include=&exclude=**%2Fdist%2F**&noise=0",
        ),
        [],
      ),
    );
    expect(filters.disabledExtensions).toEqual([".ts", ".md"]);
    expect(filters.includeGlobs).toEqual(["src/**"]);
    expect(filters.excludeGlobs).toEqual(["**/dist/**"]);
    expect(filters.hideNoise).toBe(false);
  });

  test("rejects invalid extension and glob filters", () => {
    for (const query of [
      "ext=ts",
      "ext=.ts%2Fbad",
      "ext=.ts%0Abad",
    ]) {
      expectFailure(
        parseFilterSettings(url(query), []),
        "Bad request: invalid filter",
      );
    }
    for (const query of ["include=%21", "exclude=%21"]) {
      expectFailure(
        parseFilterSettings(url(query), []),
        "Bad request: invalid filter",
      );
    }
  });

  test("only context=full asks for whole files", () => {
    expect(wantsFullContext(url("context=full"))).toBe(true);
    expect(wantsFullContext(url("context=hunks"))).toBe(false);
    expect(wantsFullContext(url(""))).toBe(false);
  });
});

describe("file request parsing", () => {
  test("parses an optional diff rev", () => {
    expect(
      expectValue(parseFileDiffRequest(url("path=src%2Fapp.ts"))),
    ).toEqual({ path: "src/app.ts", rev: null });
    expect(
      expectValue(
        parseFileDiffRequest(url("path=src%2Fapp.ts&rev=worktree")),
      ),
    ).toEqual({ path: "src/app.ts", rev: "worktree" });
    expect(
      expectValue(parseFileDiffRequest(url("path=src%2Fapp.ts&rev=abcd"))),
    ).toEqual({ path: "src/app.ts", rev: "abcd" });
  });

  test("requires a safe path and a valid rev for both endpoints", () => {
    const message = "Bad request: a safe path and rev are required";
    for (const query of [
      "",
      "path=",
      "path=..%2Fescape",
      "path=%2Fetc%2Fpasswd",
      "path=src%2Fapp.ts&rev=HEAD",
    ]) {
      expectFailure(parseFileDiffRequest(url(query)), message);
      expectFailure(parseFileContentRequest(url(query)), message);
    }
  });

  test("requires a rev for file-content and narrows it to a string", () => {
    expect(
      expectValue(
        parseFileContentRequest(url("path=src%2Fapp.ts&rev=index")),
      ),
    ).toEqual({ path: "src/app.ts", rev: "index" });
    const parsed = expectValue(
      parseFileContentRequest(url("path=src%2Fapp.ts&rev=abcd")),
    );
    const rev: string = parsed.rev;
    expect(rev).toBe("abcd");
  });
});
