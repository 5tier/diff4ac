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
  | { readonly type: "scroll"; readonly direction: 1 | -1 }
  | { readonly type: "help" }
  | { readonly type: "close-help" };

export type KeyScope = PanelId | "global" | "time-window";

export interface KeyBinding {
  readonly panel: KeyScope;
  readonly key: string;
  readonly label: string;
  readonly action: KeyAction;
}

export const KEYMAP: readonly KeyBinding[] = [
  {
    panel: "worktrees",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    panel: "worktrees",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    panel: "worktrees",
    key: "Enter",
    label: "Review Pending changes",
    action: { type: "select" },
  },
  {
    panel: "branches",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    panel: "branches",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    panel: "branches",
    key: "Enter",
    label: "Review branch",
    action: { type: "select" },
  },
  {
    panel: "commits",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    panel: "commits",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    panel: "commits",
    key: "Enter",
    label: "Select commit",
    action: { type: "select" },
  },
  {
    panel: "commits",
    key: " ",
    label: "Pick or unpick commit",
    action: { type: "toggle-pick" },
  },
  {
    panel: "commits",
    key: "v",
    label: "Start range pick",
    action: { type: "range-pick" },
  },
  {
    panel: "commits",
    key: "t",
    label: "Toggle Net Diff / Commit Stack",
    action: { type: "toggle-mode" },
  },
  {
    panel: "commits",
    key: "w",
    label: "Choose a Time Window",
    action: { type: "time-windows" },
  },
  {
    panel: "time-window",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    panel: "time-window",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    panel: "time-window",
    key: "Enter",
    label: "Choose Time Window",
    action: { type: "select" },
  },
  {
    panel: "time-window",
    key: "Escape",
    label: "Close Time Windows",
    action: { type: "time-window-close" },
  },
  {
    panel: "files",
    key: "j",
    label: "Move down",
    action: { type: "move", direction: 1 },
  },
  {
    panel: "files",
    key: "k",
    label: "Move up",
    action: { type: "move", direction: -1 },
  },
  {
    panel: "files",
    key: "Enter",
    label: "Show file diff",
    action: { type: "select" },
  },
  {
    panel: "files",
    key: "m",
    label: "Toggle Review Mark",
    action: { type: "toggle-mark" },
  },
  {
    panel: "diff",
    key: "j",
    label: "Scroll diff down",
    action: { type: "scroll", direction: 1 },
  },
  {
    panel: "diff",
    key: "k",
    label: "Scroll diff up",
    action: { type: "scroll", direction: -1 },
  },
  {
    panel: "diff",
    key: "m",
    label: "Toggle Review Mark",
    action: { type: "toggle-mark" },
  },
  {
    panel: "global",
    key: "1",
    label: "Focus Worktrees",
    action: { type: "focus", panel: "worktrees" },
  },
  {
    panel: "global",
    key: "2",
    label: "Focus Branches",
    action: { type: "focus", panel: "branches" },
  },
  {
    panel: "global",
    key: "3",
    label: "Focus Commits",
    action: { type: "focus", panel: "commits" },
  },
  {
    panel: "global",
    key: "4",
    label: "Focus Files",
    action: { type: "focus", panel: "files" },
  },
  {
    panel: "global",
    key: "0",
    label: "Focus Diff",
    action: { type: "focus", panel: "diff" },
  },
  {
    panel: "global",
    key: "Tab",
    label: "Cycle panels",
    action: { type: "cycle", direction: 1 },
  },
  {
    panel: "global",
    key: "?",
    label: "Show keybindings",
    action: { type: "help" },
  },
  {
    panel: "global",
    key: "Escape",
    label: "Close help",
    action: { type: "close-help" },
  },
];

export function bindingFor(
  panel: PanelId,
  key: string,
): KeyBinding | undefined {
  return (
    KEYMAP.find((binding) => binding.panel === panel && binding.key === key) ??
    KEYMAP.find(
      (binding) => binding.panel === "global" && binding.key === key,
    )
  );
}

export function bindingForTimeWindow(
  key: string,
): KeyBinding | undefined {
  return KEYMAP.find(
    (binding) => binding.panel === "time-window" && binding.key === key,
  );
}

export function bindingsForPanel(panel: PanelId): {
  readonly panel: readonly KeyBinding[];
  readonly global: readonly KeyBinding[];
} {
  return {
    panel: KEYMAP.filter((binding) => binding.panel === panel),
    global: KEYMAP.filter((binding) => binding.panel === "global"),
  };
}

export function nextPanel(panel: PanelId, direction: 1 | -1): PanelId {
  const index = PANEL_ORDER.indexOf(panel);
  const next =
    (index + direction + PANEL_ORDER.length) % PANEL_ORDER.length;
  return PANEL_ORDER[next] ?? "files";
}
