import { describe, expect, test } from "bun:test";
import type { BranchSummary } from "../src/types";
import type { AppState } from "../web/state/app-state";
import {
  baseState,
  c1,
  c2,
  c3,
  commits,
  reduce,
  windowAll,
} from "./helpers/app-state-fixtures";

describe("appReducer cursor moves", () => {
  const moves: ReadonlyArray<{
    readonly panel: "worktrees" | "branches" | "commits" | "files";
    readonly key: "worktreeCursor" | "branchCursor" | "commitCursor" | "fileCursor";
  }> = [
    { panel: "worktrees", key: "worktreeCursor" },
    { panel: "branches", key: "branchCursor" },
    { panel: "commits", key: "commitCursor" },
    { panel: "files", key: "fileCursor" },
  ];

  for (const { panel, key } of moves) {
    test(`moves and clamps the ${panel} cursor`, () => {
      const start = baseState({ [key]: 1 } as Partial<AppState>);

      const down = reduce(start, {
        type: "move",
        panel,
        direction: 1,
        count: 3,
      });
      expect(down[key]).toBe(2);

      const pastEnd = reduce(down, {
        type: "move",
        panel,
        direction: 1,
        count: 3,
      });
      expect(pastEnd[key]).toBe(2);

      const up = reduce(start, {
        type: "move",
        panel,
        direction: -1,
        count: 3,
      });
      expect(up[key]).toBe(0);

      const beforeStart = reduce(up, {
        type: "move",
        panel,
        direction: -1,
        count: 3,
      });
      expect(beforeStart[key]).toBe(0);
    });
  }

  test("clamps an empty list to zero", () => {
    const next = reduce(baseState({ fileCursor: 4 }), {
      type: "move",
      panel: "files",
      direction: -1,
      count: 0,
    });
    expect(next.fileCursor).toBe(0);
  });

  test("clears the range anchor when focus changes", () => {
    const next = reduce(baseState({ rangeAnchor: 2 }), {
      type: "focus",
      panel: "branches",
    });
    expect(next.focusedPanel).toBe("branches");
    expect(next.rangeAnchor).toBeNull();
  });

  test("cycles panels", () => {
    const next = reduce(baseState({ focusedPanel: "files" }), {
      type: "cycle",
      direction: 1,
    });
    expect(next.focusedPanel).toBe("diff");
    expect(next.rangeAnchor).toBeNull();
  });
});

describe("appReducer time windows", () => {
  test("opens, moves and closes the Time Window dialog", () => {
    const opened = reduce(baseState(), {
      type: "open-time-windows",
      today: "2026-11-15",
    });
    expect(opened.timeWindowOpen).toBe(true);
    expect(opened.timeWindowDialogMode).toBe("list");
    expect(opened.timeWindowCursor).toBe(0);
    expect(opened.timeWindowStart).toBe("2026-11-15");
    expect(opened.timeWindowEnd).toBe("2026-11-15");

    const moved = reduce(opened, { type: "time-window-move", direction: 1 });
    expect(moved.timeWindowCursor).toBe(1);

    const closed = reduce(moved, { type: "close-time-window" });
    expect(closed.timeWindowOpen).toBe(false);
  });

  test("picks a Time Window into a Selection", () => {
    const opened = reduce(baseState(), {
      type: "open-time-windows",
      today: "2026-11-15",
    });
    const next = reduce(opened, {
      type: "apply-time-window",
      window: windowAll,
      commits,
    });

    expect(next.timeWindowOpen).toBe(false);
    expect(next.timeWindowError).toBeNull();
    expect(next.pickedHashes).toEqual([]);
    expect(next.rangeAnchor).toBeNull();
    expect(next.selection.kind).toBe("time-window");
    if (next.selection.kind === "time-window") {
      expect(next.selection.window).toBe(windowAll);
      expect(next.selection.commits.map((commit) => commit.hash)).toEqual([
        c3.hash,
        c2.hash,
        c1.hash,
      ]);
      expect(next.selection.mode).toBe("net");
      expect(next.selection.contiguous).toBe(true);
    }
  });

  test("switches to a custom range and records errors", () => {
    const custom = reduce(
      reduce(baseState(), { type: "open-time-windows", today: "2026-11-15" }),
      { type: "time-window-custom-mode" },
    );
    expect(custom.timeWindowDialogMode).toBe("custom");

    const failed = reduce(custom, {
      type: "time-window-error",
      message: "bad range",
    });
    expect(failed.timeWindowError).toBe("bad range");

    const back = reduce(failed, { type: "time-window-back" });
    expect(back.timeWindowDialogMode).toBe("list");
    expect(back.timeWindowError).toBeNull();
  });
});

describe("appReducer display toggles", () => {
  test("toggles full file and the diff view", () => {
    const start = baseState({ fullFile: true, diffView: "side-by-side" });
    const noFullFile = reduce(start, { type: "toggle-full-file" });
    expect(noFullFile.fullFile).toBe(false);
    expect(reduce(noFullFile, { type: "toggle-full-file" }).fullFile).toBe(true);

    const unified = reduce(start, { type: "toggle-diff-view" });
    expect(unified.diffView).toBe("unified");
    expect(reduce(unified, { type: "toggle-diff-view" }).diffView).toBe(
      "side-by-side",
    );
  });

  test("cycles theme through system, light, dark", () => {
    const system = baseState({ theme: "system" });
    const light = reduce(system, { type: "cycle-theme" });
    expect(light.theme).toBe("light");
    const dark = reduce(light, { type: "cycle-theme" });
    expect(dark.theme).toBe("dark");
    expect(reduce(dark, { type: "cycle-theme" }).theme).toBe("system");
  });
});

describe("appReducer dialogs and search", () => {
  test("opens and closes the help overlay", () => {
    const open = reduce(baseState(), { type: "help-open" });
    expect(open.helpOpen).toBe(true);
    expect(reduce(open, { type: "help-close" }).helpOpen).toBe(false);
  });

  test("opens the search prompt and updates the query", () => {
    const open = reduce(baseState(), { type: "search-open" });
    expect(open.searchOpen).toBe(true);

    const typed = reduce(open, { type: "search-query", value: "alpha" });
    expect(typed.searchQuery).toBe("alpha");
    expect(typed.matchIndex).toBe(0);

    const blank = reduce(typed, { type: "search-query", value: "  " });
    expect(blank.matchIndex).toBe(-1);

    const committed = reduce(typed, { type: "search-commit" });
    expect(committed.searchOpen).toBe(false);
    expect(committed.searchQuery).toBe("alpha");

    const cleared = reduce(committed, { type: "search-clear" });
    expect(cleared.searchQuery).toBe("");
    expect(cleared.searchOpen).toBe(false);
    expect(cleared.matchIndex).toBe(-1);
  });

  test("clamps the match index to the available matches", () => {
    const state = baseState({ matchIndex: 5 });
    expect(
      reduce(state, { type: "clamp-match-index", count: 3 }).matchIndex,
    ).toBe(0);
    expect(
      reduce(state, { type: "clamp-match-index", count: 0 }).matchIndex,
    ).toBe(-1);
    expect(
      reduce(baseState({ matchIndex: 1 }), {
        type: "clamp-match-index",
        count: 3,
      }).matchIndex,
    ).toBe(1);
  });

  test("opens and closes Filters, applying a draft", () => {
    const open = reduce(baseState(), { type: "filters-open" });
    expect(open.filtersOpen).toBe(true);

    const applied = reduce(open, {
      type: "apply-filter-draft",
      draft: {
        disabledExtensions: [".ts", ".ts", ".md"],
        includeGlobs: "src/**",
        excludeGlobs: "**/*.snap",
        hideNoise: false,
      },
    });
    expect(applied.filtersOpen).toBe(false);
    expect(applied.disabledExtensions).toEqual([".ts", ".md"]);
    expect(applied.includeGlobs).toBe("src/**");
    expect(applied.excludeGlobs).toBe("**/*.snap");
    expect(applied.hideNoise).toBe(false);

    const closed = reduce(open, { type: "filters-close" });
    expect(closed.filtersOpen).toBe(false);
  });

  test("toggles Noise", () => {
    const start = baseState({ hideNoise: true });
    expect(reduce(start, { type: "toggle-noise" }).hideNoise).toBe(false);
  });
});

describe("appReducer Selection changes", () => {
  const branch: BranchSummary = {
    name: "main",
    hash: "abc",
    shortHash: "abc",
    current: true,
  };
  const baseBranch = { name: "main", ref: "refs/heads/main" };

  test("load-start resets the selected path and file cursor unless preserved", () => {
    const state = baseState({ selectedPath: "src/a.ts", fileCursor: 3 });
    const reset = reduce(state, { type: "load-start", preserve: false });
    expect(reset.selectedPath).toBeNull();
    expect(reset.fileCursor).toBe(0);

    const preserved = reduce(state, { type: "load-start", preserve: true });
    expect(preserved.selectedPath).toBe("src/a.ts");
    expect(preserved.fileCursor).toBe(3);
  });

  test("change-set-loaded sets the selected path and cursor", () => {
    const next = reduce(baseState(), {
      type: "change-set-loaded",
      selectedPath: "src/b.ts",
      fileCursor: 2,
    });
    expect(next.selectedPath).toBe("src/b.ts");
    expect(next.fileCursor).toBe(2);
  });

  test("selecting a worktree resets picks and returns to Pending", () => {
    const state = baseState({
      pickedHashes: [c1.hash, c2.hash],
      rangeAnchor: 1,
      selection: { kind: "commit", commit: c1 },
    });
    const next = reduce(state, { type: "select-worktree", index: 2 });
    expect(next.focusedPanel).toBe("worktrees");
    expect(next.worktreeCursor).toBe(2);
    expect(next.pickedHashes).toEqual([]);
    expect(next.rangeAnchor).toBeNull();
    expect(next.selection).toEqual({ kind: "pending" });
  });

  test("selecting a branch resets picks and sets a branch Selection", () => {
    const state = baseState({
      pickedHashes: [c1.hash],
      rangeAnchor: 0,
      selection: { kind: "pending" },
    });
    const next = reduce(state, {
      type: "select-branch",
      index: 1,
      branch,
      baseBranch,
    });
    expect(next.focusedPanel).toBe("branches");
    expect(next.branchCursor).toBe(1);
    expect(next.pickedHashes).toEqual([]);
    expect(next.rangeAnchor).toBeNull();
    expect(next.selection).toEqual({ kind: "branch", branch, baseBranch });
  });

  test("selecting a commit and a file updates the cursor and path", () => {
    const commitState = reduce(baseState(), {
      type: "select-commit",
      index: 1,
      commit: c2,
    });
    expect(commitState.focusedPanel).toBe("commits");
    expect(commitState.commitCursor).toBe(1);
    expect(commitState.pickedHashes).toEqual([c2.hash]);
    expect(commitState.rangeAnchor).toBeNull();
    expect(commitState.selection).toEqual({ kind: "commit", commit: c2 });

    const fileState = reduce(commitState, {
      type: "select-file",
      index: 4,
      path: "src/c.ts",
    });
    expect(fileState.focusedPanel).toBe("files");
    expect(fileState.fileCursor).toBe(4);
    expect(fileState.selectedPath).toBe("src/c.ts");
  });

  test("selection-missing clears picks and returns to Pending", () => {
    const state = baseState({
      pickedHashes: [c1.hash],
      rangeAnchor: 0,
      selection: { kind: "commit", commit: c1 },
    });
    const next = reduce(state, { type: "selection-missing" });
    expect(next.pickedHashes).toEqual([]);
    expect(next.rangeAnchor).toBeNull();
    expect(next.selection).toEqual({ kind: "pending" });
  });

  test("set-file-selection moves the cursor without changing focus", () => {
    const state = baseState({
      focusedPanel: "diff",
      selectedPath: "src/a.ts",
      fileCursor: 0,
    });
    const next = reduce(state, {
      type: "set-file-selection",
      index: 2,
      path: "src/b.ts",
    });
    expect(next.focusedPanel).toBe("diff");
    expect(next.fileCursor).toBe(2);
    expect(next.selectedPath).toBe("src/b.ts");
  });
});
