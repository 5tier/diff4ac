import { readFileSync } from "node:fs";
import { join } from "node:path";

function readVersion(): string {
  try {
    const parsed = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
