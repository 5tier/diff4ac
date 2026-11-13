import type { GitGateway } from "../git/gateway";
import type {
  ChangeFile,
  ChangeTotals,
  FileStatus,
  Hunk,
  HunkLine,
} from "../types";

const SHA1_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHA256_EMPTY_TREE =
  "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

export interface FileStatusRecord {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: FileStatus;
}

export interface DiffRange {
  readonly baseRef: string;
  readonly targetRef?: string;
}

interface NumstatRecord {
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

function nulTokens(output: string): string[] {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") {
    tokens.pop();
  }
  return tokens;
}

function statusFromCode(code: string): FileStatus {
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

function parseNumstat(output: string): Map<string, NumstatRecord> {
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

export function parseUntracked(statusOutput: string): string[] {
  const tokens = nulTokens(statusOutput);
  const untracked: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const entry = tokens[index++] ?? "";
    if (entry.length < 4) {
      continue;
    }

    const code = entry.slice(0, 2);
    const path = entry.slice(3);

    if (code[0] === "R" || code[0] === "C") {
      index++;
    }

    if (code === "??") {
      untracked.push(path);
    }
  }

  return untracked;
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

export async function emptyTreeRef(git: GitGateway): Promise<string> {
  const format = (await git.text(["rev-parse", "--show-object-format"])).trim();
  return format === "sha256" ? SHA256_EMPTY_TREE : SHA1_EMPTY_TREE;
}

function rangeArgs(range: DiffRange): string[] {
  return range.targetRef ? [range.baseRef, range.targetRef] : [range.baseRef];
}

async function diffFor(
  git: GitGateway,
  range: DiffRange,
  record: FileStatusRecord,
): Promise<string> {
  if (record.status === "untracked") {
    const { stdout } = await git.run(
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", "/dev/null", record.path],
      { allowExitCodes: [0, 1] },
    );
    return stdout.toString("utf8");
  }

  const paths = record.oldPath ? [record.oldPath, record.path] : [record.path];
  return git.text([
    "diff",
    ...rangeArgs(range),
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--",
    ...paths,
  ]);
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

export async function buildChangeFiles(
  git: GitGateway,
  range: DiffRange,
  records: readonly FileStatusRecord[],
): Promise<ChangeFile[]> {
  const { stdout } = await git.run([
    "diff",
    ...rangeArgs(range),
    "--numstat",
    "-z",
    "--find-renames",
  ]);
  const numstat = parseNumstat(stdout.toString("utf8"));

  const files: ChangeFile[] = [];
  for (const record of records) {
    const diff = await diffFor(git, range, record);
    const stats = numstat.get(record.path);
    const fallback = countDiffLines(diff);
    const binary = stats?.binary ?? looksBinary(diff);

    files.push({
      path: record.path,
      ...(record.oldPath ? { oldPath: record.oldPath } : {}),
      status: record.status,
      additions: binary ? 0 : (stats?.additions ?? fallback.additions),
      deletions: binary ? 0 : (stats?.deletions ?? fallback.deletions),
      binary,
      diff,
      hunks: binary ? [] : parseHunks(diff),
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function buildChangeFilesForRange(
  git: GitGateway,
  range: DiffRange,
): Promise<ChangeFile[]> {
  const nameStatusOutput = await git.text([
    "diff",
    ...rangeArgs(range),
    "--name-status",
    "-z",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  return buildChangeFiles(git, range, parseNameStatus(nameStatusOutput));
}

export function changeSetTotals(files: readonly ChangeFile[]): ChangeTotals {
  return files.reduce(
    (sum, file) => ({
      files: sum.files + 1,
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
