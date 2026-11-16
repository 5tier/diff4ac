import { nulTokens } from "../../shared/nul-tokens";
import type { FileStatus, Hunk, HunkLine } from "../../shared/types";

export interface FileStatusRecord {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: FileStatus;
  readonly pairedRename?: boolean;
  readonly similarity?: number;
}

export interface NumstatRecord {
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

export function statusFromCode(code: string): FileStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechanged";
    case "U":
      return "unmerged";
    default:
      return "modified";
  }
}

export function parseNameStatus(output: string): FileStatusRecord[] {
  const tokens = nulTokens(output);
  const records: FileStatusRecord[] = [];
  let index = 0;

  while (index < tokens.length) {
    const code = tokens[index++] ?? "";
    if (!code) {
      continue;
    }

    if (code[0] === "R" || code[0] === "C") {
      const oldPath = tokens[index++] ?? "";
      const path = tokens[index++] ?? oldPath;
      records.push({ path, oldPath, status: statusFromCode(code) });
    } else {
      const path = tokens[index++] ?? "";
      if (path) {
        records.push({ path, status: statusFromCode(code) });
      }
    }
  }

  return records;
}

export function parseNumstat(output: string): Map<string, NumstatRecord> {
  const tokens = nulTokens(output);
  const records = new Map<string, NumstatRecord>();
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index++] ?? "";
    if (!token) {
      continue;
    }

    const fields = token.split("\t");
    const additionsRaw = fields[0] ?? "0";
    const deletionsRaw = fields[1] ?? "0";
    let path = fields.slice(2).join("\t");

    if (path === "") {
      const oldPath = tokens[index++] ?? "";
      path = tokens[index++] ?? oldPath;
    }

    if (!path) {
      continue;
    }

    const binary = additionsRaw === "-" || deletionsRaw === "-";
    records.set(path, {
      additions: binary ? 0 : Number.parseInt(additionsRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deletionsRaw, 10) || 0,
      binary,
    });
  }

  return records;
}

export function looksBinary(diff: string): boolean {
  const header: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      break;
    }
    header.push(line);
  }

  const headerText = header.join("\n");
  return (
    headerText.includes("GIT binary patch") ||
    /^Binary files .* differ$/m.test(headerText)
  );
}

function parseIntOrZero(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: HunkLine[];
  } | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) {
      current = {
        header: line,
        oldStart: parseIntOrZero(match[1], 0),
        oldLines: parseIntOrZero(match[2], 1),
        newStart: parseIntOrZero(match[3], 0),
        newLines: parseIntOrZero(match[4], 1),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+")) {
      current.lines.push({
        type: "add",
        content: line.slice(1),
        oldLine: null,
        newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      current.lines.push({
        type: "delete",
        content: line.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine++;
    } else if (line.startsWith(" ")) {
      current.lines.push({
        type: "context",
        content: line.slice(1),
        oldLine,
        newLine,
      });
      oldLine++;
      newLine++;
    } else if (line.startsWith("\\ No newline at end of file")) {
      continue;
    } else if (line === "") {
      current = null;
    }
  }

  return hunks;
}

export function countDiffLines(diff: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      additions++;
    } else if (line.startsWith("-")) {
      deletions++;
    }
  }

  return { additions, deletions };
}
