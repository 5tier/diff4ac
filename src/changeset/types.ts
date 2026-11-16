/** Arguments shared across the Change Set scope builders and file assemblers. */
export interface DiffRange {
  readonly baseRef: string;
  readonly targetRef?: string;
  readonly oldRev?: string | null;
  readonly newRev?: string | null;
}

export interface ChangeFileOptions {
  readonly largeDiffThreshold?: number;
  readonly includeLargeDiffs?: boolean;
  /** Show every unchanged line of each file around its changes. */
  readonly fullContext?: boolean;
}
