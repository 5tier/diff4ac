export function nulTokens(output: string): string[] {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") {
    tokens.pop();
  }
  return tokens;
}

interface StatusEntry {
  readonly code: string;
  readonly path: string;
}

function parseStatusEntries(statusOutput: string): StatusEntry[] {
  const tokens = nulTokens(statusOutput);
  const entries: StatusEntry[] = [];
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

    entries.push({ code, path });
  }

  return entries;
}

export function parseUntracked(statusOutput: string): string[] {
  return parseStatusEntries(statusOutput)
    .filter((entry) => entry.code === "??")
    .map((entry) => entry.path);
}

export function parseUnstagedDeletions(statusOutput: string): string[] {
  return parseStatusEntries(statusOutput)
    .filter((entry) => entry.code[1] === "D")
    .map((entry) => entry.path);
}

export function countPendingFiles(statusOutput: string): number {
  return parseStatusEntries(statusOutput).length;
}
