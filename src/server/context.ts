import type { CompiledAgentPattern } from "../agents";
import type { GitGateway } from "../git/gateway";
import type { ReviewMarkStore } from "../review/marks";
import type { ConfigInfo, WatchStatus } from "../../shared/types";

export interface EventHub {
  subscribe(listener: () => void): () => void;
  emit(): void;
}

export interface RequestContext {
  readonly git: GitGateway;
  readonly token: string;
  readonly port: number;
  readonly webDir: string;
  readonly repositoryId: string;
  readonly reviewMarks: ReviewMarkStore;
  readonly config: ConfigInfo;
  readonly agentPatterns: readonly CompiledAgentPattern[];
  readonly commitPageSize: number;
  readonly events: EventHub;
  readonly watchStatus: () => readonly WatchStatus[];
}
