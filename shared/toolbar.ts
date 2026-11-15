import type { DiffViewMode } from "./diff/rows";
import {
  KEYMAP,
  PANEL_ORDER,
  type KeyAction,
  type KeyBinding,
  type KeyScope,
  type PanelId,
  type ToolbarGroupId,
} from "./keymap";
import type { ChangeViewMode, Theme } from "./types";
import { modeLabel } from "./changeset/selection";

export type { ToolbarGroupId } from "./keymap";

export const TOOLBAR_GROUP_LABELS: Record<ToolbarGroupId, string> = {
  panels: "Panels",
  view: "View",
  navigate: "Navigate",
  review: "Review",
  commits: "Commits",
  repository: "Repository",
  help: "Help",
};

export const TOOLBAR_GROUP_ORDER: readonly ToolbarGroupId[] = [
  "panels",
  "view",
  "navigate",
  "review",
  "commits",
  "repository",
  "help",
];

interface ToolbarGroupDefinition {
  readonly id: ToolbarGroupId;
  readonly bindingIds: readonly string[];
}

function deriveToolbarGroups(
  keymap: readonly KeyBinding[],
): readonly ToolbarGroupDefinition[] {
  const grouped = new Map<ToolbarGroupId, { id: string; order: number }[]>();
  for (const binding of keymap) {
    if (!binding.toolbarGroup) {
      continue;
    }
    const entries = grouped.get(binding.toolbarGroup) ?? [];
    entries.push({ id: binding.id, order: binding.toolbarOrder ?? 0 });
    grouped.set(binding.toolbarGroup, entries);
  }

  return TOOLBAR_GROUP_ORDER.map((id) => ({
    id,
    bindingIds: (grouped.get(id) ?? [])
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.id),
  }));
}

export const TOOLBAR_GROUPS: readonly ToolbarGroupDefinition[] =
  deriveToolbarGroups(KEYMAP);

export interface ToolbarState {
  readonly hasFile: boolean;
  readonly selectedFileCollapsed: boolean;
  readonly hasCommit: boolean;
  readonly canToggleMode: boolean;
  readonly mode: ChangeViewMode | null;
  readonly agentFilter: string | null;
  readonly hasAgentCommits: boolean;
  readonly searchActive: boolean;
  readonly searchMatchCount: number;
  readonly diffView: DiffViewMode;
  readonly fullFile: boolean;
  readonly theme: Theme;
  readonly hideNoise: boolean;
  readonly filtersOpen: boolean;
  readonly repositoryChanged: boolean;
}

export interface ToolbarItem {
  readonly id: string;
  readonly group: ToolbarGroupId;
  readonly label: string;
  readonly key: string;
  readonly displayKey: string;
  readonly action: KeyAction;
  readonly panel: KeyScope;
  readonly panelAction: PanelId | null;
  readonly toggle: boolean;
  readonly pressed: boolean;
  readonly highlighted: boolean;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly value: string | null;
}

export interface ToolbarGroup {
  readonly id: ToolbarGroupId;
  readonly label: string;
  readonly items: readonly ToolbarItem[];
}

interface ItemState {
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly toggle?: boolean;
  readonly pressed?: boolean;
  readonly highlighted?: boolean;
  readonly value?: string;
}

function themeLabel(theme: Theme): string {
  return theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";
}

function isPanelId(scope: KeyScope): scope is PanelId {
  return (PANEL_ORDER as readonly string[]).includes(scope);
}

export function displayKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  if (key === "Escape") {
    return "Esc";
  }
  return key;
}

function itemState(binding: KeyBinding, state: ToolbarState): ItemState {
  switch (binding.id) {
    case "global.toggleDiffView":
      return {
        enabled: true,
        toggle: true,
        pressed: state.diffView === "side-by-side",
      };
    case "global.toggleFullFile":
      return { enabled: true, toggle: true, pressed: state.fullFile };
    case "global.cycleTheme":
      return { enabled: true, value: themeLabel(state.theme) };
    case "global.noise":
      return { enabled: true, toggle: true, pressed: state.hideNoise };
    case "global.filters":
      return { enabled: true, highlighted: state.filtersOpen };
    case "diff.previousHunk":
    case "diff.nextHunk":
    case "diff.previousFile":
    case "diff.nextFile":
    case "files.toggleMark":
      return state.hasFile
        ? { enabled: true }
        : { enabled: false, disabledReason: "No file selected" };
    case "files.expandDiff":
      if (!state.hasFile) {
        return { enabled: false, disabledReason: "No file selected" };
      }
      return state.selectedFileCollapsed
        ? { enabled: true }
        : { enabled: false, disabledReason: "No collapsed diff to load" };
    case "search.nextMatch":
    case "search.previousMatch":
      if (!state.searchActive) {
        return { enabled: false, disabledReason: "No search active" };
      }
      return state.searchMatchCount > 0
        ? { enabled: true }
        : { enabled: false, disabledReason: "No search matches" };
    case "search.clear":
      return state.searchActive
        ? { enabled: true }
        : { enabled: false, disabledReason: "No search active" };
    case "commits.toggleMode":
      return state.canToggleMode
        ? {
            enabled: true,
            toggle: true,
            pressed: state.mode === "stack",
            ...(state.mode ? { value: modeLabel(state.mode) } : {}),
          }
        : {
            enabled: false,
            disabledReason: "No contiguous commit Selection",
            ...(state.mode ? { value: modeLabel(state.mode) } : {}),
          };
    case "commits.cycleAgentFilter":
      return {
        enabled: state.hasAgentCommits,
        ...(state.hasAgentCommits
          ? {}
          : { disabledReason: "No Agent commits" }),
        value: state.agentFilter ?? "All",
      };
    case "commits.rangePick":
    case "commits.togglePick":
      return state.hasCommit
        ? { enabled: true }
        : { enabled: false, disabledReason: "No commit selected" };
    case "global.refresh":
      return { enabled: true, highlighted: state.repositoryChanged };
    default:
      return { enabled: true };
  }
}

export function buildToolbar(
  keymap: readonly KeyBinding[],
  state: ToolbarState,
): readonly ToolbarGroup[] {
  const byId = new Map(keymap.map((binding) => [binding.id, binding] as const));

  return deriveToolbarGroups(keymap).map((group) => ({
    id: group.id,
    label: TOOLBAR_GROUP_LABELS[group.id],
    items: group.bindingIds.flatMap((id) => {
      const binding = byId.get(id);
      if (!binding) {
        return [];
      }

      const item = itemState(binding, state);
      return [
        {
          id: binding.id,
          group: group.id,
          label: binding.shortLabel ?? binding.label,
          key: binding.key,
          displayKey: displayKey(binding.key),
          action: binding.action,
          panel: binding.panel,
          panelAction: isPanelId(binding.panel) ? binding.panel : null,
          toggle: item.toggle ?? false,
          pressed: item.pressed ?? false,
          highlighted: item.highlighted ?? false,
          enabled: item.enabled,
          disabledReason: item.disabledReason ?? null,
          value: item.value ?? null,
        },
      ];
    }),
  }));
}
