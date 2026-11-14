import { describe, expect, test } from "bun:test";
import { applyKeybindingOverrides, KEYMAP } from "../src/keymap";
import {
  buildToolbar,
  displayKey,
  TOOLBAR_GROUP_LABELS,
  type ToolbarState,
} from "../src/toolbar";

function state(overrides: Partial<ToolbarState> = {}): ToolbarState {
  return {
    hasFile: true,
    selectedFileCollapsed: false,
    hasCommit: true,
    canToggleMode: false,
    mode: null,
    agentFilter: null,
    hasAgentCommits: false,
    searchActive: false,
    searchMatchCount: 0,
    diffView: "side-by-side",
    fullFile: true,
    theme: "system",
    hideNoise: true,
    filtersOpen: false,
    repositoryChanged: false,
    ...overrides,
  };
}

function item(
  toolbarState: ToolbarState,
  id: string,
  keymap = KEYMAP,
) {
  return buildToolbar(keymap, toolbarState)
    .flatMap((group) => group.items)
    .find((entry) => entry.id === id);
}

describe("command toolbar model", () => {
  test("builds the documented groups in order from the keymap", () => {
    const groups = buildToolbar(KEYMAP, state());

    expect(groups.map((group) => group.id)).toEqual([
      "panels",
      "view",
      "navigate",
      "review",
      "commits",
      "repository",
      "help",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      TOOLBAR_GROUP_LABELS.panels,
      TOOLBAR_GROUP_LABELS.view,
      TOOLBAR_GROUP_LABELS.navigate,
      TOOLBAR_GROUP_LABELS.review,
      TOOLBAR_GROUP_LABELS.commits,
      TOOLBAR_GROUP_LABELS.repository,
      TOOLBAR_GROUP_LABELS.help,
    ]);
    expect(
      groups.map((group) => group.items.map((entry) => entry.id)),
    ).toEqual([
      [
        "global.focusWorktrees",
        "global.focusBranches",
        "global.focusCommits",
        "global.focusFiles",
        "global.focusDiff",
      ],
      [
        "global.toggleDiffView",
        "global.toggleFullFile",
        "global.cycleTheme",
        "global.noise",
        "global.filters",
      ],
      [
        "global.search",
        "diff.previousHunk",
        "diff.nextHunk",
        "diff.previousFile",
        "diff.nextFile",
        "search.nextMatch",
        "search.previousMatch",
        "search.clear",
      ],
      ["files.toggleMark", "files.expandDiff"],
      [
        "commits.toggleMode",
        "commits.timeWindows",
        "commits.cycleAgentFilter",
        "commits.rangePick",
        "commits.togglePick",
      ],
      ["global.refresh"],
      ["global.help"],
    ]);
  });

  test("shows the effective key from the merged keymap", () => {
    expect(item(state(), "global.toggleDiffView")?.key).toBe("s");
    expect(item(state(), "global.cycleTheme")?.key).toBe("D");
    expect(item(state(), "commits.toggleMode")?.key).toBe("t");
    expect(item(state(), "commits.togglePick")?.displayKey).toBe("Space");

    const overridden = applyKeybindingOverrides({
      "global.toggleDiffView": "d",
      "commits.toggleMode": "T",
    });

    expect(item(state(), "global.toggleDiffView", overridden)?.key).toBe("d");
    expect(item(state(), "global.toggleDiffView", overridden)?.displayKey).toBe(
      "d",
    );
    expect(item(state(), "commits.toggleMode", overridden)?.key).toBe("T");
  });

  test("knows which panel a scoped action belongs to", () => {
    expect(item(state(), "commits.toggleMode")?.panelAction).toBe("commits");
    expect(item(state(), "files.toggleMark")?.panelAction).toBe("files");
    expect(item(state(), "diff.nextHunk")?.panelAction).toBe("diff");
    expect(item(state(), "global.refresh")?.panelAction).toBeNull();
    expect(item(state(), "search.nextMatch")?.panelAction).toBeNull();
  });

  test("reports toggle state with aria-pressed inputs", () => {
    expect(item(state(), "global.toggleDiffView")?.pressed).toBe(true);
    expect(
      item(state({ diffView: "unified" }), "global.toggleDiffView")?.pressed,
    ).toBe(false);
    expect(item(state(), "global.toggleFullFile")?.pressed).toBe(true);
    expect(
      item(state({ fullFile: false }), "global.toggleFullFile")?.pressed,
    ).toBe(false);
    expect(item(state(), "global.noise")?.pressed).toBe(true);
    expect(item(state({ hideNoise: false }), "global.noise")?.pressed).toBe(
      false,
    );
    expect(item(state(), "global.toggleDiffView")?.toggle).toBe(true);
    expect(item(state(), "global.refresh")?.toggle).toBe(false);
  });

  test("disables actions that cannot apply and explains why", () => {
    expect(item(state({ hasFile: false }), "files.toggleMark")).toMatchObject({
      enabled: false,
      disabledReason: "No file selected",
    });
    expect(item(state({ hasFile: false }), "diff.nextHunk")).toMatchObject({
      enabled: false,
      disabledReason: "No file selected",
    });
    expect(
      item(state({ selectedFileCollapsed: false }), "files.expandDiff"),
    ).toMatchObject({
      enabled: false,
      disabledReason: "No collapsed diff to load",
    });
    expect(
      item(state({ selectedFileCollapsed: true }), "files.expandDiff")?.enabled,
    ).toBe(true);

    expect(item(state(), "search.nextMatch")).toMatchObject({
      enabled: false,
      disabledReason: "No search active",
    });
    expect(
      item(
        state({ searchActive: true, searchMatchCount: 0 }),
        "search.previousMatch",
      ),
    ).toMatchObject({
      enabled: false,
      disabledReason: "No search matches",
    });
    expect(
      item(
        state({ searchActive: true, searchMatchCount: 2 }),
        "search.nextMatch",
      )?.enabled,
    ).toBe(true);
    expect(item(state(), "search.clear")).toMatchObject({
      enabled: false,
      disabledReason: "No search active",
    });

    expect(item(state(), "commits.toggleMode")).toMatchObject({
      enabled: false,
      disabledReason: "No contiguous commit Selection",
    });
    expect(item(state({ hasCommit: false }), "commits.togglePick")).toMatchObject(
      {
        enabled: false,
        disabledReason: "No commit selected",
      },
    );
    expect(item(state(), "commits.cycleAgentFilter")).toMatchObject({
      enabled: false,
      disabledReason: "No Agent commits",
      value: "All",
    });
  });

  test("shows the current theme value", () => {
    expect(item(state(), "global.cycleTheme")).toMatchObject({
      enabled: true,
      value: "System",
      toggle: false,
    });
    expect(
      item(state({ theme: "light" }), "global.cycleTheme")?.value,
    ).toBe("Light");
    expect(
      item(state({ theme: "dark" }), "global.cycleTheme")?.value,
    ).toBe("Dark");
  });

  test("shows the current mode, Agent and refresh highlight", () => {
    expect(
      item(
        state({ canToggleMode: true, mode: "net" }),
        "commits.toggleMode",
      ),
    ).toMatchObject({
      enabled: true,
      pressed: false,
      value: "Net Diff",
    });
    expect(
      item(
        state({ canToggleMode: true, mode: "stack" }),
        "commits.toggleMode",
      ),
    ).toMatchObject({
      enabled: true,
      pressed: true,
      value: "Commit Stack",
    });
    expect(
      item(
        state({ hasAgentCommits: true, agentFilter: "Claude" }),
        "commits.cycleAgentFilter",
      ),
    ).toMatchObject({
      enabled: true,
      value: "Claude",
    });
    expect(
      item(state({ repositoryChanged: true }), "global.refresh")?.highlighted,
    ).toBe(true);
    expect(item(state(), "global.refresh")?.highlighted).toBe(false);
  });

  test("formats special keys for the keyboard chip", () => {
    expect(displayKey(" ")).toBe("Space");
    expect(displayKey("Escape")).toBe("Esc");
    expect(displayKey("]")).toBe("]");
  });
});
