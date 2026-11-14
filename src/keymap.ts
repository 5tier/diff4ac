export type PanelId = "worktrees" | "branches" | "commits" | "files" | "diff";

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
  | { readonly type: "time-windows" }
  | { readonly type: "time-window-close" }
  | { readonly type: "toggle-mark" }
  | { readonly type: "filters" }
  | { readonly type: "filters-close" }
  | { readonly type: "toggle-noise" }
  | { readonly type: "refresh" }
  | { readonly type: "scroll"; readonly direction: 1 | -1 }
  | { readonly type: "help" }
  | { readonly type: "close-help" };

export type KeyScope = PanelId | "global" | "time-window" | "filters";

export interface KeyBinding {
  readonly id: string;
  readonly panel: KeyScope;
  readonly key: string;
  readonly label: string;
  readonly action: KeyAction;
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
    panel: "commits",
    key: " ",
    label: "Pick or unpick commit",
    action: { type: "toggle-pick" },
  },
  {
    id: "commits.rangePick",
    panel: "commits",
    key: "v",
    label: "Start range pick",
    action: { type: "range-pick" },
  },
  {
    id: "commits.toggleMode",
    panel: "commits",
    key: "t",
    label: "Toggle Net Diff / Commit Stack",
    action: { type: "toggle-mode" },
  },
  {
    id: "commits.timeWindows",
    panel: "commits",
    key: "w",
    label: "Choose a Time Window",
    action: { type: "time-windows" },
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
    panel: "files",
    key: "m",
    label: "Toggle Review Mark",
    action: { type: "toggle-mark" },
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
    id: "global.focusWorktrees",
    panel: "global",
    key: "1",
    label: "Focus Worktrees",
    action: { type: "focus", panel: "worktrees" },
  },
  {
    id: "global.focusBranches",
    panel: "global",
    key: "2",
    label: "Focus Branches",
    action: { type: "focus", panel: "branches" },
  },
  {
    id: "global.focusCommits",
    panel: "global",
    key: "3",
    label: "Focus Commits",
    action: { type: "focus", panel: "commits" },
  },
  {
    id: "global.focusFiles",
    panel: "global",
    key: "4",
    label: "Focus Files",
    action: { type: "focus", panel: "files" },
  },
  {
    id: "global.focusDiff",
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
    panel: "global",
    key: "?",
    label: "Show keybindings",
    action: { type: "help" },
  },
  {
    id: "global.filters",
    panel: "global",
    key: "f",
    label: "Open Filters",
    action: { type: "filters" },
  },
  {
    id: "global.noise",
    panel: "global",
    key: "n",
    label: "Toggle Noise",
    action: { type: "toggle-noise" },
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
    panel: "global",
    key: "r",
    label: "Refresh Repository",
    action: { type: "refresh" },
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
