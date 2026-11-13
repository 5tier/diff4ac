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

async function localBranchExists(
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
): Promise<BaseBranch | null> {
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

export async function listBranches(git: GitGateway): Promise<BranchList> {
  const worktree: WorktreeInfo = {
    path: git.worktreeRoot,
    branch: await git.currentBranch(),
  };

  const [baseBranch, output] = await Promise.all([
    detectBaseBranch(git),
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
