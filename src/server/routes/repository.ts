import { listBranches } from "../../repository/branches";
import { listCommits } from "../../repository/commits";
import { listWorktrees } from "../../repository/worktrees";
import { json, text } from "../http";
import { parseCommitSkip } from "../query";
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
  const skip = parseCommitSkip(url);
  if (!skip.ok) {
    return Promise.resolve(text(skip.message, skip.status));
  }

  const agent = url.searchParams.get("agent") ?? undefined;
  return withGit(context, url, async (git) =>
    json(
      await listCommits(git, {
        agentPatterns: context.agentPatterns,
        agent: agent || undefined,
        skip: skip.value,
        limit: context.commitPageSize,
      }),
    ),
  );
}
