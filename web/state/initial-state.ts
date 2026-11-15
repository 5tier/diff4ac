import type { AppState } from "./app-state";
import { localDateInputValue } from "../../src/time-windows";
import { readStoredTheme } from "../theme";

function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function createInitialAppState(): AppState {
  const today = localDateInputValue(new Date());
  return {
    focusedPanel: "files",
    worktreeCursor: 0,
    branchCursor: 0,
    commitCursor: 0,
    fileCursor: 0,
    pickedHashes: [],
    rangeAnchor: null,
    selection: { kind: "pending" },
    selectedPath: null,
    filtersOpen: false,
    disabledExtensions: [],
    includeGlobs: "",
    excludeGlobs: "",
    hideNoise: true,
    fullFile: readSessionStorage("diff4ac-full-file") !== "0",
    helpOpen: false,
    diffView:
      readSessionStorage("diff4ac-diff-view") === "unified"
        ? "unified"
        : "side-by-side",
    theme: readStoredTheme(),
    timeWindowOpen: false,
    timeWindowDialogMode: "list",
    timeWindowCursor: 0,
    timeWindowError: null,
    timeWindowStart: today,
    timeWindowEnd: today,
    searchQuery: "",
    searchOpen: false,
    matchIndex: -1,
    agentFilter: null,
  };
}
