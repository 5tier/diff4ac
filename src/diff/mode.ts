import type { ChangeFile } from "../types";

export interface FileModeChange {
  readonly oldMode: string;
  readonly newMode: string;
}

const EXECUTABLE_MODE = "100755";

export function parseModeChange(diff: string): FileModeChange | null {
  let oldMode: string | null = null;
  let newMode: string | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      break;
    }

    const oldMatch = /^old mode (\d+)$/.exec(line);
    if (oldMatch?.[1]) {
      oldMode = oldMatch[1];
      continue;
    }

    const newMatch = /^new mode (\d+)$/.exec(line);
    if (newMatch?.[1]) {
      newMode = newMatch[1];
    }
  }

  return oldMode && newMode ? { oldMode, newMode } : null;
}

export function modeChangeFor(
  file: Pick<ChangeFile, "oldMode" | "newMode">,
): FileModeChange | null {
  return file.oldMode && file.newMode
    ? { oldMode: file.oldMode, newMode: file.newMode }
    : null;
}

export function isModeOnlyChange(
  file: Pick<
    ChangeFile,
    | "oldMode"
    | "newMode"
    | "binary"
    | "collapsed"
    | "additions"
    | "deletions"
    | "hunks"
  >,
): boolean {
  return (
    modeChangeFor(file) !== null &&
    !file.binary &&
    file.collapsed !== true &&
    file.additions === 0 &&
    file.deletions === 0 &&
    file.hunks.length === 0
  );
}

export function describeModeChange(change: FileModeChange): string {
  const suffix =
    change.oldMode !== EXECUTABLE_MODE && change.newMode === EXECUTABLE_MODE
      ? " (now executable)"
      : change.oldMode === EXECUTABLE_MODE &&
          change.newMode !== EXECUTABLE_MODE
        ? " (no longer executable)"
        : "";

  return `Mode changed: ${change.oldMode} → ${change.newMode}${suffix}`;
}
