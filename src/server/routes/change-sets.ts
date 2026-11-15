import { buildBranchChangeSet } from "../../changeset/branch";
import { buildCommitChangeSet } from "../../changeset/commit";
import {
  buildCommitsChangeSet,
  buildTimeWindowChangeSet,
} from "../../changeset/commits";
import { buildPendingChangeSet } from "../../changeset/pending";
import { text } from "../http";
import {
  parseBranchScope,
  parseCommitScope,
  parseCommitsScope,
  parseTimeWindowScope,
  wantsFullContext,
} from "../query";
import { withChangeSet } from "./shared";
import type { RouteRequest } from "./types";

export function handlePending({
  context,
  url,
}: RouteRequest): Promise<Response> {
  return withChangeSet(context, url, (git) =>
    buildPendingChangeSet(git, { fullContext: wantsFullContext(url) }),
  );
}

export function handleCommit({ context, url }: RouteRequest): Promise<Response> {
  const scope = parseCommitScope(url);
  if (!scope.ok) {
    return Promise.resolve(text(scope.message, scope.status));
  }

  return withChangeSet(context, url, (git) =>
    buildCommitChangeSet(git, scope.value.hash, {
      agentPatterns: context.agentPatterns,
      fullContext: wantsFullContext(url),
    }),
  );
}

export function handleCommitSet({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const scope = parseCommitsScope(url);
  if (!scope.ok) {
    return Promise.resolve(text(scope.message, scope.status));
  }

  return withChangeSet(context, url, (git) =>
    buildCommitsChangeSet(git, scope.value.hashes, scope.value.mode, {
      agentPatterns: context.agentPatterns,
      fullContext: wantsFullContext(url),
    }),
  );
}

export function handleTimeWindow({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const scope = parseTimeWindowScope(url);
  if (!scope.ok) {
    return Promise.resolve(text(scope.message, scope.status));
  }

  return withChangeSet(context, url, (git) =>
    buildTimeWindowChangeSet(git, scope.value.window, scope.value.mode, {
      agentPatterns: context.agentPatterns,
      ...(scope.value.agent ? { agent: scope.value.agent } : {}),
      fullContext: wantsFullContext(url),
    }),
  );
}

export function handleBranch({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const scope = parseBranchScope(url);
  if (!scope.ok) {
    return Promise.resolve(text(scope.message, scope.status));
  }

  return withChangeSet(context, url, (git) =>
    buildBranchChangeSet(git, scope.value.name, context.config.baseBranch, {
      fullContext: wantsFullContext(url),
    }),
  );
}
