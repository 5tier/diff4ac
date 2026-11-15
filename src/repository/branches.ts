import type { GitGateway } from "../git/gateway";
import type {
  BaseBranch,
  BranchList,
  BranchSummary,
  WorktreeInfo,
} from "../types";

export class UnknownBranchError extends Error {
  constructor(name: string) {
    super(`branch "${name}" was not found`);
    this.name = "UnknownBranchError";
  }
}

export async function localBranchExists(
  git: GitGateway,
  name: string,
): Promise<boolean> {
  const result = await git.run(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
    { allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

export async function detectBaseBranch(
  git: GitGateway,
  override: string | null = null,
): Promise<BaseBranch | null> {
  if (override) {
    if (await localBranchExists(git, override)) {
      return { name: override, ref: `refs/heads/${override}` };
    }
  }

  const originHead = await git.run(
    ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
    { allowExitCodes: [0, 1] },
  );

  if (originHead.exitCode === 0) {
    const remoteRef = originHead.stdout.toString("utf8").trim();
    if (remoteRef) {
      const name = remoteRef.startsWith("origin/")
        ? remoteRef.slice("origin/".length)
        : remoteRef;
      const ref = (await localBranchExists(git, name)) ? name : remoteRef;
      return { name, ref };
    }
  }

  for (const candidate of ["main", "master"]) {
    if (await localBranchExists(git, candidate)) {
      return { name: candidate, ref: candidate };
    }
  }

  return null;
}

/**
 * The Base Branch a Change Set must use: a configured override that no longer
 * exists is an error, unlike the display-only fallback in `detectBaseBranch`.
 */
export async function requireBaseBranch(
  git: GitGateway,
  override: string | null = null,
): Promise<BaseBranch> {
  if (override) {
    if (await localBranchExists(git, override)) {
      return { name: override, ref: `refs/heads/${override}` };
    }
    throw new UnknownBranchError(override);
  }

  const detected = await detectBaseBranch(git);
  if (!detected) {
    throw new Error(
      "could not detect a Base Branch (origin/HEAD, main or master)",
    );
  }
  return detected;
}

function parseBranches(output: string): BranchSummary[] {
  const branches: BranchSummary[] = [];

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }

    const [head, name, hash, shortHash] = line.split("\0");
    if (!name || !hash) {
      continue;
    }

    branches.push({
      name,
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      current: head?.trim() === "*",
    });
  }

  return branches;
}

export async function listBranches(
  git: GitGateway,
  baseBranchOverride: string | null = null,
): Promise<BranchList> {
  const worktree: WorktreeInfo = {
    path: git.worktreeRoot,
    branch: await git.currentBranch(),
  };

  const [baseBranch, output] = await Promise.all([
    detectBaseBranch(git, baseBranchOverride),
    git.text([
      "for-each-ref",
      "--format=%(HEAD)%00%(refname:short)%00%(objectname)%00%(objectname:short)",
      "refs/heads",
    ]),
  ]);

  return {
    worktree,
    baseBranch,
    branches: parseBranches(output),
  };
}

export async function readBranch(
  git: GitGateway,
  name: string,
): Promise<BranchSummary | null> {
  const result = await git.run(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
    { allowExitCodes: [0, 1] },
  );
  if (result.exitCode !== 0) {
    return null;
  }

  const hash = result.stdout.toString("utf8").trim();
  const shortHash = (
    await git.text(["rev-parse", "--short", `refs/heads/${name}`])
  ).trim();

  return {
    name,
    hash,
    shortHash,
    current: (await git.currentBranch()) === name,
  };
}
