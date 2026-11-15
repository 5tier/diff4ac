export type PanelId = "worktrees" | "branches" | "commits" | "files" | "diff";

export type ToolbarGroupId =
  | "panels"
  | "view"
  | "navigate"
  | "review"
  | "commits"
  | "repository"
  | "help";

export const PANEL_ORDER: readonly PanelId[] = [
  "worktrees",
  "branches",
  "commits",
  "files",
  "diff",
];

export const PANEL_LABELS: Record<PanelId, string> = {
  worktrees: "Worktrees",
  branches: "Branches",
  commits: "Commits",
  files: "Files",
  diff: "Diff",
};

export type KeyAction =
  | { readonly type: "focus"; readonly panel: PanelId }
  | { readonly type: "cycle"; readonly direction: 1 | -1 }
  | { readonly type: "move"; readonly direction: 1 | -1 }
  | { readonly type: "select" }
  | { readonly type: "toggle-pick" }
  | { readonly type: "range-pick" }
  | { readonly type: "toggle-mode" }
  | { readonly type: "toggle-files-view" }
  | { readonly type: "expand" }
  | { readonly type: "collapse" }
  | { readonly type: "time-windows" }
  | { readonly type: "time-window-close" }
  | { readonly type: "cycle-agent-filter" }
  | { readonly type: "toggle-mark" }
  | { readonly type: "expand-diff" }
  | { readonly type: "filters" }
  | { readonly type: "filters-close" }
  | { readonly type: "toggle-noise" }
  | { readonly type: "refresh" }
  | { readonly type: "toggle-diff-view" }
  | { readonly type: "toggle-full-file" }
  | { readonly type: "cycle-theme" }
  | { readonly type: "scroll"; readonly direction: 1 | -1 }
  | { readonly type: "jump-hunk"; readonly direction: 1 | -1 }
  | { readonly type: "jump-file"; readonly direction: 1 | -1 }
  | { readonly type: "search-open" }
  | { readonly type: "search-next"; readonly direction: 1 | -1 }
  | { readonly type: "search-clear" }
  | { readonly type: "help" }
  | { readonly type: "close-help" };

export type KeyScope =
  | PanelId
  | "global"
  | "time-window"
  | "filters"
  | "search";

export interface KeyBinding {
  readonly id: string;
  readonly panel: KeyScope;
  readonly key: string;
  readonly label: string;
  readonly action: KeyAction;
  /** Toolbar group this binding belongs to, if it is shown in the toolbar. */
  readonly toolbarGroup?: ToolbarGroupId;
  /** Order within the toolbar group. */
  readonly toolbarOrder?: number;
  /** Compact toolbar label, when the keymap label is too long. */
  readonly shortLabel?: string;
}

export const KEYMAP: readonly KeyBinding[] = [
  {
    id: "worktrees.moveDown",
    panel: "worktrees",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    id: "worktrees.moveUp",
    panel: "worktrees",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    id: "worktrees.select",
    panel: "worktrees",
    key: "Enter",
    label: "Review Pending changes",
    action: { type: "select" },
  },
  {
    id: "branches.moveDown",
    panel: "branches",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    id: "branches.moveUp",
    panel: "branches",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    id: "branches.select",
    panel: "branches",
    key: "Enter",
    label: "Review branch",
    action: { type: "select" },
  },
  {
    id: "commits.moveDown",
    panel: "commits",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    id: "commits.moveUp",
    panel: "commits",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    id: "commits.select",
    panel: "commits",
    key: "Enter",
    label: "Select commit",
    action: { type: "select" },
  },
  {
    id: "commits.togglePick",
    toolbarGroup: "commits",
    toolbarOrder: 4,
    shortLabel: "Pick",
    panel: "commits",
    key: " ",
    label: "Pick or unpick commit",
    action: { type: "toggle-pick" },
  },
  {
    id: "commits.rangePick",
    toolbarGroup: "commits",
    toolbarOrder: 3,
    shortLabel: "Range pick",
    panel: "commits",
    key: "v",
    label: "Start range pick",
    action: { type: "range-pick" },
  },
  {
    id: "commits.toggleMode",
    toolbarGroup: "commits",
    toolbarOrder: 0,
    shortLabel: "Mode",
    panel: "commits",
    key: "t",
    label: "Toggle Net Diff / Commit Stack",
    action: { type: "toggle-mode" },
  },
  {
    id: "commits.timeWindows",
    toolbarGroup: "commits",
    toolbarOrder: 1,
    shortLabel: "Time Window",
    panel: "commits",
    key: "w",
    label: "Choose a Time Window",
    action: { type: "time-windows" },
  },
  {
    id: "commits.cycleAgentFilter",
    toolbarGroup: "commits",
    toolbarOrder: 2,
    shortLabel: "Agent",
    panel: "commits",
    key: "a",
    label: "Filter commits by Agent",
    action: { type: "cycle-agent-filter" },
  },
  {
    id: "time-window.moveDown",
    panel: "time-window",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    id: "time-window.moveUp",
    panel: "time-window",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    id: "time-window.choose",
    panel: "time-window",
    key: "Enter",
    label: "Choose Time Window",
    action: { type: "select" },
  },
  {
    id: "time-window.close",
    panel: "time-window",
    key: "Escape",
    label: "Close Time Windows",
    action: { type: "time-window-close" },
  },
  {
    id: "files.moveDown",
    panel: "files",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    id: "files.moveUp",
    panel: "files",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    id: "files.select",
    panel: "files",
    key: "Enter",
    label: "Show file diff",
    action: { type: "select" },
  },
  {
    id: "files.toggleMark",
    toolbarGroup: "review",
    toolbarOrder: 0,
    shortLabel: "Review Mark",
    panel: "files",
    key: "m",
    label: "Toggle Review Mark",
    action: { type: "toggle-mark" },
  },
  {
    id: "files.expandDiff",
    toolbarGroup: "review",
    toolbarOrder: 1,
    shortLabel: "Load diff",
    panel: "files",
    key: "x",
    label: "Load large diff",
    action: { type: "expand-diff" },
  },
  {
    id: "files.toggleTree",
    toolbarGroup: "view",
    toolbarOrder: 5,
    shortLabel: "Tree",
    panel: "files",
    key: "T",
    label: "Toggle folder tree",
    action: { type: "toggle-files-view" },
  },
  {
    id: "files.expand",
    panel: "files",
    key: "l",
    label: "Expand folder",
    action: { type: "expand" },
  },
  {
    id: "files.collapse",
    panel: "files",
    key: "h",
    label: "Collapse folder or go to parent",
    action: { type: "collapse" },
  },
  {
    id: "diff.scrollDown",
    panel: "diff",
    key: "j",
    label: "Scroll diff down",
    action: { type: "scroll", direction: 1 },
  },
  {
    id: "diff.scrollUp",
    panel: "diff",
    key: "k",
    label: "Scroll diff up",
    action: { type: "scroll", direction: -1 },
  },
  {
    id: "diff.toggleMark",
    panel: "diff",
    key: "m",
    label: "Toggle Review Mark",
    action: { type: "toggle-mark" },
  },
  {
    id: "diff.expandDiff",
    panel: "diff",
    key: "x",
    label: "Load large diff",
    action: { type: "expand-diff" },
  },
  {
    id: "diff.nextHunk",
    toolbarGroup: "navigate",
    toolbarOrder: 2,
    shortLabel: "Next hunk",
    panel: "diff",
    key: "]",
    label: "Next hunk",
    action: { type: "jump-hunk", direction: 1 },
  },
  {
    id: "diff.previousHunk",
    toolbarGroup: "navigate",
    toolbarOrder: 1,
    shortLabel: "Previous hunk",
    panel: "diff",
    key: "[",
    label: "Previous hunk",
    action: { type: "jump-hunk", direction: -1 },
  },
  {
    id: "diff.nextFile",
    toolbarGroup: "navigate",
    toolbarOrder: 4,
    shortLabel: "Next file",
    panel: "diff",
    key: "}",
    label: "Next file",
    action: { type: "jump-file", direction: 1 },
  },
  {
    id: "diff.previousFile",
    toolbarGroup: "navigate",
    toolbarOrder: 3,
    shortLabel: "Previous file",
    panel: "diff",
    key: "{",
    label: "Previous file",
    action: { type: "jump-file", direction: -1 },
  },
  {
    id: "global.focusWorktrees",
    toolbarGroup: "panels",
    toolbarOrder: 0,
    shortLabel: "Worktrees",
    panel: "global",
    key: "1",
    label: "Focus Worktrees",
    action: { type: "focus", panel: "worktrees" },
  },
  {
    id: "global.focusBranches",
    toolbarGroup: "panels",
    toolbarOrder: 1,
    shortLabel: "Branches",
    panel: "global",
    key: "2",
    label: "Focus Branches",
    action: { type: "focus", panel: "branches" },
  },
  {
    id: "global.focusCommits",
    toolbarGroup: "panels",
    toolbarOrder: 2,
    shortLabel: "Commits",
    panel: "global",
    key: "3",
    label: "Focus Commits",
    action: { type: "focus", panel: "commits" },
  },
  {
    id: "global.focusFiles",
    toolbarGroup: "panels",
    toolbarOrder: 3,
    shortLabel: "Files",
    panel: "global",
    key: "4",
    label: "Focus Files",
    action: { type: "focus", panel: "files" },
  },
  {
    id: "global.focusDiff",
    toolbarGroup: "panels",
    toolbarOrder: 4,
    shortLabel: "Diff",
    panel: "global",
    key: "0",
    label: "Focus Diff",
    action: { type: "focus", panel: "diff" },
  },
  {
    id: "global.cycle",
    panel: "global",
    key: "Tab",
    label: "Cycle panels",
    action: { type: "cycle", direction: 1 },
  },
  {
    id: "global.help",
    toolbarGroup: "help",
    toolbarOrder: 0,
    shortLabel: "Help",
    panel: "global",
    key: "?",
    label: "Show keybindings",
    action: { type: "help" },
  },
  {
    id: "global.filters",
    toolbarGroup: "view",
    toolbarOrder: 4,
    shortLabel: "Filters",
    panel: "global",
    key: "f",
    label: "Open Filters",
    action: { type: "filters" },
  },
  {
    id: "global.noise",
    toolbarGroup: "view",
    toolbarOrder: 3,
    shortLabel: "Noise",
    panel: "global",
    key: "n",
    label: "Toggle Noise",
    action: { type: "toggle-noise" },
  },
  {
    id: "global.search",
    toolbarGroup: "navigate",
    toolbarOrder: 0,
    shortLabel: "Search",
    panel: "global",
    key: "/",
    label: "Search Change Set",
    action: { type: "search-open" },
  },
  {
    id: "search.nextMatch",
    toolbarGroup: "navigate",
    toolbarOrder: 5,
    shortLabel: "Next match",
    panel: "search",
    key: "n",
    label: "Next match",
    action: { type: "search-next", direction: 1 },
  },
  {
    id: "search.previousMatch",
    toolbarGroup: "navigate",
    toolbarOrder: 6,
    shortLabel: "Previous match",
    panel: "search",
    key: "N",
    label: "Previous match",
    action: { type: "search-next", direction: -1 },
  },
  {
    id: "search.clear",
    toolbarGroup: "navigate",
    toolbarOrder: 7,
    shortLabel: "Clear search",
    panel: "search",
    key: "Escape",
    label: "Clear search",
    action: { type: "search-clear" },
  },
  {
    id: "filters.close",
    panel: "filters",
    key: "Escape",
    label: "Close Filters",
    action: { type: "filters-close" },
  },
  {
    id: "global.refresh",
    toolbarGroup: "repository",
    toolbarOrder: 0,
    shortLabel: "Refresh",
    panel: "global",
    key: "r",
    label: "Refresh Repository",
    action: { type: "refresh" },
  },
  {
    id: "global.toggleDiffView",
    toolbarGroup: "view",
    toolbarOrder: 0,
    shortLabel: "Side-by-side",
    panel: "global",
    key: "s",
    label: "Toggle side-by-side diff",
    action: { type: "toggle-diff-view" },
  },
  {
    id: "global.toggleFullFile",
    toolbarGroup: "view",
    toolbarOrder: 1,
    shortLabel: "Full file",
    panel: "global",
    key: "c",
    label: "Toggle full file / changed hunks only",
    action: { type: "toggle-full-file" },
  },
  {
    id: "global.cycleTheme",
    toolbarGroup: "view",
    toolbarOrder: 2,
    shortLabel: "Theme",
    panel: "global",
    key: "D",
    label: "Cycle theme",
    action: { type: "cycle-theme" },
  },
  {
    id: "global.closeHelp",
    panel: "global",
    key: "Escape",
    label: "Close help",
    action: { type: "close-help" },
  },
];

export type KeybindingOverrides = Readonly<Record<string, string>>;

export function applyKeybindingOverrides(
  overrides: KeybindingOverrides,
): readonly KeyBinding[] {
  return KEYMAP.map((binding) => {
    const key = overrides[binding.id];
    return key ? { ...binding, key } : binding;
  });
}

export function bindingFor(
  keymap: readonly KeyBinding[],
  panel: PanelId,
  key: string,
): KeyBinding | undefined {
  return (
    keymap.find((binding) => binding.panel === panel && binding.key === key) ??
    keymap.find(
      (binding) => binding.panel === "global" && binding.key === key,
    )
  );
}

export function bindingForTimeWindow(
  keymap: readonly KeyBinding[],
  key: string,
): KeyBinding | undefined {
  return keymap.find(
    (binding) => binding.panel === "time-window" && binding.key === key,
  );
}

export function bindingForFilters(
  keymap: readonly KeyBinding[],
  key: string,
): KeyBinding | undefined {
  return keymap.find(
    (binding) => binding.panel === "filters" && binding.key === key,
  );
}

export function bindingForSearch(
  keymap: readonly KeyBinding[],
  key: string,
): KeyBinding | undefined {
  return keymap.find(
    (binding) => binding.panel === "search" && binding.key === key,
  );
}

export function bindingsForPanel(
  keymap: readonly KeyBinding[],
  panel: PanelId,
): {
  readonly panel: readonly KeyBinding[];
  readonly global: readonly KeyBinding[];
} {
  return {
    panel: keymap.filter((binding) => binding.panel === panel),
    global: keymap.filter((binding) => binding.panel === "global"),
  };
}

export function nextPanel(panel: PanelId, direction: 1 | -1): PanelId {
  const index = PANEL_ORDER.indexOf(panel);
  const next =
    (index + direction + PANEL_ORDER.length) % PANEL_ORDER.length;
  return PANEL_ORDER[next] ?? "files";
}
