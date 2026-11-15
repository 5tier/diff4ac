import type { CommitSummary, TimeWindow } from "../../shared/types";
import {
  appReducer,
  createInitialAppState,
  type AppAction,
  type AppState,
} from "../../web/state/app-state";

export function makeCommit(
  hash: string,
  firstParent: string | null = null,
  agent: string | null = null,
): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message: `message ${hash}`,
    author: { name: "Ada", email: "ada@example.com" },
    committedAt: "2026-06-01T12:00:00Z",
    relativeDate: "now",
    firstParent,
    agent,
  };
}

export const c1 = makeCommit("c1aaaaaa");
export const c2 = makeCommit("c2bbbbbb", c1.hash);
export const c3 = makeCommit("c3cccccc", c2.hash);
export const commits = [c3, c2, c1];

export const windowAll: TimeWindow = {
  preset: "custom",
  start: "2026-01-01T00:00:00Z",
  end: "2027-01-01T00:00:00Z",
  label: "All",
};

export function baseState(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialAppState(), ...overrides };
}

export function reduce(state: AppState, action: AppAction): AppState {
  return appReducer(state, action);
}
