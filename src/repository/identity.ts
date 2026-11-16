import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { GitGateway } from "../git/gateway";

export async function repositoryIdentity(git: GitGateway): Promise<string> {
  const commonDir = (
    await git.text(["rev-parse", "--git-common-dir"])
  ).trim();
  const absolute = resolve(git.worktreeRoot, commonDir);

  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
