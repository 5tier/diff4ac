import { describe, expect, test } from "bun:test";
import type { AppState } from "../web/state/app-state";
import {
  baseState,
  c1,
  c2,
  c3,
  commits,
  makeCommit,
  reduce,
  windowAll,
} from "./helpers/app-state-fixtures";

describe("appReducer commit selection", () => {
  test("picks a single commit into a commit Selection", () => {
    const next = reduce(baseState(), {
      type: "toggle-pick",
      commit: c2,
      commits,
      mode: "net",
    });

    expect(next.pickedHashes).toEqual([c2.hash]);
    expect(next.selection).toEqual({ kind: "commit", commit: c2 });
    expect(next.rangeAnchor).toBeNull();
  });

  test("picks a second commit into a commits Selection and unpicks back", () => {
    const first = reduce(baseState(), {
      type: "toggle-pick",
      commit: c2,
      commits,
      mode: "net",
    });
    const second = reduce(first, {
      type: "toggle-pick",
      commit: c3,
      commits,
      mode: "net",
    });

    expect(second.pickedHashes).toEqual([c2.hash, c3.hash]);
    expect(second.selection.kind).toBe("commits");
    if (second.selection.kind === "commits") {
      expect(second.selection.commits.map((commit) => commit.hash)).toEqual([
        c3.hash,
        c2.hash,
      ]);
      expect(second.selection.mode).toBe("net");
      expect(second.selection.contiguous).toBe(true);
    }

    const unpicked = reduce(second, {
      type: "toggle-pick",
      commit: c3,
      commits,
      mode: "net",
    });
    expect(unpicked.pickedHashes).toEqual([c2.hash]);
    expect(unpicked.selection).toEqual({ kind: "commit", commit: c2 });
  });

  test("makes a non-contiguous pick a Commit Stack selection", () => {
    const next = reduce(baseState(), {
      type: "toggle-pick",
      commit: c1,
      commits,
      mode: "net",
    });
    const gapped = reduce(next, {
      type: "toggle-pick",
      commit: c3,
      commits,
      mode: "net",
    });

    expect(gapped.selection.kind).toBe("commits");
    if (gapped.selection.kind === "commits") {
      expect(gapped.selection.contiguous).toBe(false);
      expect(gapped.selection.mode).toBe("stack");
    }
  });

  test("unpicking the last commit returns to Pending", () => {
    const picked = reduce(baseState(), {
      type: "toggle-pick",
      commit: c2,
      commits,
      mode: "net",
    });
    const none = reduce(picked, {
      type: "toggle-pick",
      commit: c2,
      commits,
      mode: "net",
    });
    expect(none.pickedHashes).toEqual([]);
    expect(none.selection).toEqual({ kind: "pending" });
  });

  test("range-picks from the cursor and extends on move", () => {
    const start = reduce(baseState({ commitCursor: 2 }), {
      type: "range-pick",
      index: 2,
      commit: c1,
    });
    expect(start.pickedHashes).toEqual([c1.hash]);
    expect(start.selection).toEqual({ kind: "commit", commit: c1 });

    const moved = reduce(start, {
      type: "move-commit",
      direction: -1,
      commits,
    });
    expect(moved.commitCursor).toBe(1);
    expect(moved.pickedHashes).toEqual([c2.hash, c1.hash]);
    expect(moved.selection.kind).toBe("commits");
    if (moved.selection.kind === "commits") {
      expect(moved.selection.mode).toBe("net");
      expect(moved.selection.contiguous).toBe(true);
    }

    const clamped = reduce(moved, {
      type: "move-commit",
      direction: 1,
      commits,
    });
    expect(clamped.commitCursor).toBe(2);
    expect(clamped.pickedHashes).toEqual([c1.hash]);
  });

  test("toggles Net Diff and Commit Stack for a contiguous Selection", () => {
    const commitsSelection: AppState = baseState({
      selection: {
        kind: "commits",
        commits: [c3, c2],
        mode: "net",
        contiguous: true,
      },
    });
    const stacked = reduce(commitsSelection, { type: "toggle-mode" });
    expect(
      stacked.selection.kind === "commits" && stacked.selection.mode,
    ).toBe("stack");

    const nonContiguous: AppState = baseState({
      selection: {
        kind: "commits",
        commits: [c3, c1],
        mode: "stack",
        contiguous: false,
      },
    });
    expect(reduce(nonContiguous, { type: "toggle-mode" })).toBe(nonContiguous);
  });

  test("cycles the Agent filter and refilters a Time Window", () => {
    const claude = makeCommit("d4dddddd", null, "claude");
    const withAgents = [c3, claude, c2, c1];
    const windowSelection: AppState = baseState({
      agentFilter: null,
      selection: {
        kind: "time-window",
        window: windowAll,
        commits: withAgents,
        mode: "net",
        contiguous: false,
      },
    });

    const next = reduce(windowSelection, {
      type: "cycle-agent-filter",
      agents: ["claude"],
      allCommits: withAgents,
    });
    expect(next.agentFilter).toBe("claude");
    expect(next.pickedHashes).toEqual([]);
    expect(next.rangeAnchor).toBeNull();
    expect(next.selection.kind).toBe("time-window");
    if (next.selection.kind === "time-window") {
      expect(next.selection.commits.map((commit) => commit.hash)).toEqual([
        claude.hash,
      ]);
    }

    const cleared = reduce(next, {
      type: "cycle-agent-filter",
      agents: ["claude"],
      allCommits: withAgents,
    });
    expect(cleared.agentFilter).toBeNull();
  });
});
