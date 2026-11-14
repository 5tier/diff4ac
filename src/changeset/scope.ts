import type { CompiledAgentPattern } from "../agents";
import type { GitGateway } from "../git/gateway";
import type {
  ChangeSet,
  ChangeViewMode,
  TimeWindow,
} from "../types";
import { buildBranchChangeSet } from "./branch";
import { buildCommitChangeSet } from "./commit";
import {
  buildCommitsChangeSet,
  buildTimeWindowChangeSet,
} from "./commits";
import type { ChangeFileOptions } from "./files";
import { buildPendingChangeSet } from "./pending";

export type ChangeSetScope =
  | { readonly kind: "pending" }
  | { readonly kind: "commit"; readonly hash: string }
  | {
      readonly kind: "commits";
      readonly hashes: readonly string[];
      readonly mode: ChangeViewMode;
    }
  | {
      readonly kind: "time-window";
      readonly window: TimeWindow;
      readonly mode: ChangeViewMode | "auto";
      readonly agent?: string;
    }
  | { readonly kind: "branch"; readonly name: string };

export interface ScopedChangeSetOptions extends ChangeFileOptions {
  readonly agentPatterns?: readonly CompiledAgentPattern[];
  readonly baseBranch?: string | null;
}

export async function buildScopedChangeSet(
  git: GitGateway,
  scope: ChangeSetScope,
  options: ScopedChangeSetOptions = {},
): Promise<ChangeSet> {
  switch (scope.kind) {
    case "pending":
      return buildPendingChangeSet(git, options);
    case "commit":
      return buildCommitChangeSet(git, scope.hash, options);
    case "commits":
      return buildCommitsChangeSet(
        git,
        scope.hashes,
        scope.mode,
        options,
      );
    case "time-window":
      return buildTimeWindowChangeSet(git, scope.window, scope.mode, {
        agentPatterns: options.agentPatterns,
        agent: scope.agent,
        ...options,
      });
    case "branch":
      return buildBranchChangeSet(
        git,
        scope.name,
        options.baseBranch ?? null,
        options,
      );
  }
}
