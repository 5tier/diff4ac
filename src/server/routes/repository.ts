import { listBranches } from "../../repository/branches";
import { listCommits } from "../../repository/commits";
import { listWorktrees } from "../../repository/worktrees";
import { json } from "../http";
import { jsonGitFailure, withContextGit, withGit } from "./shared";
import type { RouteRequest } from "./types";

export function handleWorktrees({
  context,
}: RouteRequest): Promise<Response> {
  return withContextGit(
    context,
    async (git) => json(await listWorktrees(git)),
    jsonGitFailure,
  );
}

export function handleBranches({
  context,
  url,
}: RouteRequest): Promise<Response> {
  return withGit(context, url, async (git) =>
    json(await listBranches(git, context.config.baseBranch)),
  );
}

export function handleCommits({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const agent = url.searchParams.get("agent") ?? undefined;
  return withGit(context, url, async (git) =>
    json(
      await listCommits(git, {
        agentPatterns: context.agentPatterns,
        agent: agent || undefined,
      }),
    ),
  );
}
