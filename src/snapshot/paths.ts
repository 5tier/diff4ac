import { rankPaths } from "../../shared/fuzzy-paths";
import type { SnapshotPathMatch } from "../../shared/types";
import type { GitGateway } from "../git/gateway";
import type { SnapshotChangeMap, SnapshotRef } from "./scope";

const commitPathCache = new Map<string, readonly string[]>();

function cacheKey(git: GitGateway, rev: string): string {
  return `${git.worktreeRoot}\0${rev}`;
}

async function commitPaths(
  git: GitGateway,
  rev: string,
): Promise<readonly string[]> {
  const key = cacheKey(git, rev);
  const cached = commitPathCache.get(key);
  if (cached) {
    return cached;
  }

  const output = await git.text(
    [
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      rev,
    ],
    { emptyOk: true },
  );
  const paths = output.split("\0").filter(Boolean);
  commitPathCache.set(key, paths);
  return paths;
}

async function worktreePaths(git: GitGateway): Promise<readonly string[]> {
  const [tracked, untracked] = await Promise.all([
    git.text(["ls-files", "-z"], { emptyOk: true }),
    git.text(["ls-files", "--others", "--exclude-standard", "-z"], {
      emptyOk: true,
    }),
  ]);
  return [
    ...new Set(
      `${tracked}\0${untracked}`.split("\0").filter(Boolean),
    ),
  ];
}

export async function searchSnapshotPaths(
  git: GitGateway,
  snapshot: SnapshotRef,
  index: SnapshotChangeMap,
  query: string,
  limit: number,
): Promise<readonly SnapshotPathMatch[]> {
  const paths =
    snapshot.kind === "commit"
      ? await commitPaths(git, snapshot.rev)
      : await worktreePaths(git);

  return rankPaths(query, paths, limit).map((path) => {
    const change = index.get(path);
    return {
      path,
      ...(change?.status ? { status: change.status } : {}),
    };
  });
}
