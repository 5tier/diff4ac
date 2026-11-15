import type { AppAction } from "./app-actions";
import type { AppState } from "./app-state";

/**
 * Code View cases for the app reducer. Returns null for every other action so
 * the main reducer keeps its own switch small.
 */
export function reduceCodeView(
  state: AppState,
  action: AppAction,
): AppState | null {
  switch (action.type) {
    case "toggle-code-view":
      return state.codeView
        ? { ...state, codeView: false }
        : {
            ...state,
            codeView: true,
            codeViewSide: "after",
            codeViewFocus: action.path ? "code" : "tree",
            codeViewOpenPath: action.path ?? null,
            codeViewLine: action.line ?? 1,
            codeViewFull: false,
            codeViewFinderOpen: false,
            codeViewNotice: null,
          };
    case "code-view-side":
      return {
        ...state,
        codeViewSide: action.side,
        codeViewFull: false,
        codeViewNotice: null,
      };
    case "code-view-focus":
      return { ...state, codeViewFocus: action.focus };
    case "code-view-cursor":
      return { ...state, codeViewCursor: Math.max(0, action.index) };
    case "code-view-expand": {
      const expanded = new Set(state.codeViewExpanded);
      for (const key of action.keys) {
        expanded.add(key);
      }
      return { ...state, codeViewExpanded: [...expanded] };
    }
    case "code-view-collapse":
      return state.codeViewExpanded.includes(action.key)
        ? {
            ...state,
            codeViewExpanded: state.codeViewExpanded.filter(
              (key) => key !== action.key,
            ),
          }
        : state;
    case "code-view-toggle-folder":
      return state.codeViewExpanded.includes(action.key)
        ? {
            ...state,
            codeViewExpanded: state.codeViewExpanded.filter(
              (key) => key !== action.key,
            ),
          }
        : {
            ...state,
            codeViewExpanded: [...state.codeViewExpanded, action.key],
          };
    case "code-view-open":
      return {
        ...state,
        codeViewOpenPath: action.path,
        codeViewLine: action.line ?? 1,
        codeViewFull: false,
        codeViewFocus: action.path ? "code" : "tree",
        codeViewNotice: null,
        codeViewFinderOpen: false,
      };
    case "code-view-line":
      return { ...state, codeViewLine: Math.max(1, action.line) };
    case "code-view-full":
      return { ...state, codeViewFull: action.full };
    case "code-view-finder-open":
      return {
        ...state,
        codeViewFinderOpen: true,
        codeViewFinderQuery: "",
        codeViewFinderIndex: 0,
      };
    case "code-view-finder-close":
      return { ...state, codeViewFinderOpen: false };
    case "code-view-finder-query":
      return {
        ...state,
        codeViewFinderQuery: action.value,
        codeViewFinderIndex: 0,
      };
    case "code-view-finder-index":
      return { ...state, codeViewFinderIndex: Math.max(0, action.index) };
    case "code-view-notice":
      return { ...state, codeViewNotice: action.message };
    case "code-view-help-open":
      return { ...state, codeViewHelpOpen: true };
    case "code-view-help-close":
      return { ...state, codeViewHelpOpen: false };
    case "code-view-restore":
      return {
        ...state,
        codeViewExpanded: [...action.expanded],
        codeViewCursor: Math.max(0, action.cursor),
        codeViewOpenPath: action.openPath,
        codeViewLine: Math.max(1, action.line),
        codeViewFocus: action.openPath ? "code" : "tree",
        codeViewFull: false,
        codeViewFinderOpen: false,
        codeViewNotice: null,
      };
    case "code-view-reset":
      return {
        ...state,
        codeViewExpanded: [],
        codeViewCursor: 0,
        codeViewLine: 1,
        codeViewFull: false,
        codeViewFinderOpen: false,
        codeViewFinderQuery: "",
        codeViewFinderIndex: 0,
        codeViewNotice: null,
        ...(action.keepOpen
          ? {}
          : { codeViewOpenPath: null, codeViewFocus: "tree" as const }),
      };
    default:
      return null;
  }
}
