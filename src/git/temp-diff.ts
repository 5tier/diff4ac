import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GitGateway } from "./gateway";

/**
 * Diff the two sides of a paired rename, which live at different paths.
 *
 * This is the only helper that writes the content diff4ac already read back
 * to disk. It writes exclusively under `os.tmpdir()` in a fresh directory
 * that it removes afterwards, never inside the Repository; the directory is
 * handed to `GitGateway.diffNoIndex`, which refuses a path inside the
 * worktree.
 */
export async function diffTempFiles(
  git: GitGateway,
  oldPath: string,
  oldContent: Uint8Array,
  newPath: string,
  newContent: Uint8Array,
  extraArgs: readonly string[] = [],
): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "diff4ac-rename-"));
  try {
    const oldFile = join(directory, "old", oldPath);
    const newFile = join(directory, "new", newPath);
    mkdirSync(dirname(oldFile), { recursive: true });
    mkdirSync(dirname(newFile), { recursive: true });
    writeFileSync(oldFile, oldContent);
    writeFileSync(newFile, newContent);

    const result = await git.diffNoIndex(
      directory,
      join("old", oldPath),
      join("new", newPath),
      extraArgs,
    );
    return result.stdout.toString("utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
