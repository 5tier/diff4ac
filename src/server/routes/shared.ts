import { NonContiguousNetDiffError } from "../../changeset/commits";
import { NoMergeBaseError } from "../../changeset/branch";
import { applyFilters } from "../../filters";
import type { GitGateway } from "../../git/gateway";
import { UnknownBranchError } from "../../repository/branches";
import { UnknownCommitError } from "../../repository/commits";
import { openWorktree, UnknownWorktreeError } from "../../repository/worktrees";
import { annotateChangeSet } from "../../review/marks";
import type { ChangeSet } from "../../../shared/types";
import type { RequestContext } from "../context";
import { json, text } from "../http";
import { parseFilterSettings } from "../query";

export function gitApiFailure(error: unknown): Response {
  if (error instanceof UnknownWorktreeError) {
    return text(error.message, 404);
  }
  if (error instanceof UnknownBranchError) {
    return text(error.message, 404);
  }
  if (error instanceof UnknownCommitError) {
    return text(error.message, 404);
  }
  if (error instanceof NonContiguousNetDiffError) {
    return text(error.message, 400);
  }
  if (error instanceof NoMergeBaseError) {
    return text(error.message, 409);
  }
  return json(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    500,
  );
}

/**
 * Endpoints that always answer with a JSON body, including on failure.
 * Only Worktrees uses this today.
 */
export function jsonGitFailure(error: unknown): Response {
  return json(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    500,
  );
}

export function gitForRequest(
  context: RequestContext,
  url: URL,
): Promise<GitGateway> {
  const worktreePath = url.searchParams.get("worktree");
  return worktreePath
    ? openWorktree(context.git, worktreePath)
    : Promise.resolve(context.git);
}

type FailureMapper = (error: unknown) => Response;

export async function withGit(
  context: RequestContext,
  url: URL,
  handler: (git: GitGateway) => Response | Promise<Response>,
  failure: FailureMapper = gitApiFailure,
): Promise<Response> {
  try {
    return await handler(await gitForRequest(context, url));
  } catch (error) {
    return failure(error);
  }
}

/**
 * Run a handler against the server's own Repository, ignoring the `worktree`
 * query parameter. Only the Worktrees listing uses this.
 */
export async function withContextGit(
  context: RequestContext,
  handler: (git: GitGateway) => Response | Promise<Response>,
  failure: FailureMapper = gitApiFailure,
): Promise<Response> {
  try {
    return await handler(context.git);
  } catch (error) {
    return failure(error);
  }
}

export function reviewJson(
  changeSet: ChangeSet,
  context: RequestContext,
  url: URL,
): Response {
  const filters = parseFilterSettings(url, context.config.noise);
  if (!filters.ok) {
    return text(filters.message, filters.status);
  }

  return json(
    annotateChangeSet(
      applyFilters(changeSet, filters.value),
      context.reviewMarks,
      context.repositoryId,
    ),
  );
}

/** Open the request's Repository, build a Change Set and annotate it. */
export function withChangeSet(
  context: RequestContext,
  url: URL,
  build: (git: GitGateway) => Promise<ChangeSet>,
  failure: FailureMapper = gitApiFailure,
): Promise<Response> {
  return withGit(
    context,
    url,
    async (git) => reviewJson(await build(git), context, url),
    failure,
  );
}
