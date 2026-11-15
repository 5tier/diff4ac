import { describe, expect, test } from "bun:test";
import { appReducer, createInitialAppState } from "../web/state/app-state";
import type { AppAction } from "../web/state/app-actions";
import type { AppState } from "../web/state/app-state";

function reduce(state: AppState, action: AppAction): AppState {
  return appReducer(state, action);
}

describe("Code View reducer", () => {
  test("toggles into Code View with the requested file and line", () => {
    const opened = reduce(createInitialAppState(), {
      type: "toggle-code-view",
      path: "src/app.ts",
      line: 12,
    });
    expect(opened.codeView).toBe(true);
    expect(opened.codeViewSide).toBe("after");
    expect(opened.codeViewFocus).toBe("code");
    expect(opened.codeViewOpenPath).toBe("src/app.ts");
    expect(opened.codeViewLine).toBe(12);
    expect(opened.codeViewFull).toBe(false);

    const closed = reduce(opened, { type: "toggle-code-view" });
    expect(closed.codeView).toBe(false);
    expect(closed.codeViewOpenPath).toBe("src/app.ts");
  });

  test("table of Code View actions", () => {
    const base = reduce(createInitialAppState(), {
      type: "toggle-code-view",
      path: "src/app.ts",
      line: 3,
    });
    const cases: readonly [AppAction, Partial<AppState>][] = [
      [
        { type: "code-view-side", side: "before" },
        { codeViewSide: "before", codeViewFull: false },
      ],
      [{ type: "code-view-focus", focus: "tree" }, { codeViewFocus: "tree" }],
      [{ type: "code-view-cursor", index: 4 }, { codeViewCursor: 4 }],
      [
        { type: "code-view-expand", keys: ["src", "src/deep"] },
        { codeViewExpanded: ["src", "src/deep"] },
      ],
      [
        { type: "code-view-toggle-folder", key: "src" },
        { codeViewExpanded: ["src"] },
      ],
      [
        { type: "code-view-open", path: "README.md" },
        {
          codeViewOpenPath: "README.md",
          codeViewLine: 1,
          codeViewFocus: "code",
        },
      ],
      [{ type: "code-view-line", line: 9 }, { codeViewLine: 9 }],
      [{ type: "code-view-full", full: true }, { codeViewFull: true }],
      [{ type: "code-view-finder-open" }, { codeViewFinderOpen: true }],
      [
        { type: "code-view-finder-query", value: "app" },
        { codeViewFinderQuery: "app", codeViewFinderIndex: 0 },
      ],
      [
        { type: "code-view-finder-index", index: 2 },
        { codeViewFinderIndex: 2 },
      ],
      [{ type: "code-view-finder-close" }, { codeViewFinderOpen: false }],
      [{ type: "code-view-notice", message: "hi" }, { codeViewNotice: "hi" }],
      [{ type: "code-view-help-open" }, { codeViewHelpOpen: true }],
      [{ type: "code-view-help-close" }, { codeViewHelpOpen: false }],
      [
        {
          type: "code-view-restore",
          expanded: ["src", "src/deep"],
          cursor: 3,
          openPath: "src/deep/unchanged.ts",
          line: 7,
        },
        {
          codeViewExpanded: ["src", "src/deep"],
          codeViewCursor: 3,
          codeViewOpenPath: "src/deep/unchanged.ts",
          codeViewLine: 7,
          codeViewFocus: "code",
        },
      ],
    ];

    for (const [action, expected] of cases) {
      expect(reduce(base, action)).toMatchObject(expected);
    }
  });

  test("collapse keeps only the targeted folder", () => {
    const expanded = reduce(
      reduce(createInitialAppState(), {
        type: "code-view-expand",
        keys: ["a", "b"],
      }),
      { type: "code-view-collapse", key: "a" },
    );
    expect(expanded.codeViewExpanded).toEqual(["b"]);
  });

  test("reset clears remembered state but can keep the open file", () => {
    const opened = reduce(createInitialAppState(), {
      type: "toggle-code-view",
      path: "src/app.ts",
      line: 4,
    });
    const cleared = reduce(opened, {
      type: "code-view-reset",
      keepOpen: false,
    });
    expect(cleared.codeViewOpenPath).toBeNull();
    expect(cleared.codeViewFocus).toBe("tree");
    expect(cleared.codeViewLine).toBe(1);
    expect(cleared.codeViewExpanded).toEqual([]);

    const kept = reduce(opened, { type: "code-view-reset", keepOpen: true });
    expect(kept.codeViewOpenPath).toBe("src/app.ts");
  });
});
