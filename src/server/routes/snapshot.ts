import { imageContentType } from "../../changeset/images";
import {
  parseSnapshotFileRequest,
  parseSnapshotPathsRequest,
  parseSnapshotRawRequest,
  parseSnapshotTreeRequest,
} from "../query";
import { json, text } from "../http";
import {
  readSnapshotBytes,
  readSnapshotFile,
  SnapshotTooLargeError,
} from "../../snapshot/file";
import { searchSnapshotPaths } from "../../snapshot/paths";
import { resolveSnapshotScopes, type SnapshotRef } from "../../snapshot/scope";
import { listSnapshotTree } from "../../snapshot/tree";
import { imageResponse } from "./files";
import { withGit } from "./shared";
import type { RouteRequest } from "./types";

function snapshotFor(
  side: "after" | "before",
  scopes: {
    readonly after: SnapshotRef;
    readonly before: SnapshotRef;
  },
): SnapshotRef {
  return side === "after" ? scopes.after : scopes.before;
}

export function handleSnapshotTree({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const parsed = parseSnapshotTreeRequest(url);
  if (!parsed.ok) {
    return Promise.resolve(text(parsed.message, parsed.status));
  }

  return withGit(context, url, async (git) => {
    const scopes = await resolveSnapshotScopes(git, parsed.value.scope, {
      agentPatterns: context.agentPatterns,
      baseBranch: context.config.baseBranch,
    });
    const index =
      parsed.value.side === "after" ? scopes.afterIndex : scopes.beforeIndex;
    const entries = await listSnapshotTree(
      git,
      snapshotFor(parsed.value.side, scopes),
      index,
      parsed.value.dir,
      context.config.noise,
    );
    return entries ? json(entries) : text("Not found", 404);
  });
}

export function handleSnapshotFile({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const parsed = parseSnapshotFileRequest(url);
  if (!parsed.ok) {
    return Promise.resolve(text(parsed.message, parsed.status));
  }

  return withGit(context, url, async (git) => {
    const scopes = await resolveSnapshotScopes(git, parsed.value.scope, {
      agentPatterns: context.agentPatterns,
      baseBranch: context.config.baseBranch,
    });
    const index =
      parsed.value.side === "after" ? scopes.afterIndex : scopes.beforeIndex;
    try {
      const file = await readSnapshotFile(
        git,
        snapshotFor(parsed.value.side, scopes),
        scopes.before,
        index,
        parsed.value.path,
        parsed.value.full,
        parsed.value.side,
      );
      return file ? json(file) : text("Not found", 404);
    } catch (error) {
      if (error instanceof SnapshotTooLargeError) {
        return text(error.message, 413);
      }
      throw error;
    }
  });
}

export function handleSnapshotRaw({
  request,
  context,
  url,
}: RouteRequest): Promise<Response> {
  const parsed = parseSnapshotRawRequest(url);
  if (!parsed.ok) {
    return Promise.resolve(text(parsed.message, parsed.status));
  }

  return withGit(context, url, async (git) => {
    const contentType = imageContentType(parsed.value.path);
    if (!contentType) {
      return text("Not found", 404);
    }

    const scopes = await resolveSnapshotScopes(git, parsed.value.scope, {
      agentPatterns: context.agentPatterns,
      baseBranch: context.config.baseBranch,
    });
    const index =
      parsed.value.side === "after" ? scopes.afterIndex : scopes.beforeIndex;
    const bytes = await readSnapshotBytes(
      git,
      snapshotFor(parsed.value.side, scopes),
      scopes.before,
      index,
      parsed.value.path,
      parsed.value.side,
    );
    return bytes
      ? imageResponse(bytes, contentType, request.method)
      : text("Not found", 404);
  });
}

export function handleSnapshotPaths({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const parsed = parseSnapshotPathsRequest(url);
  if (!parsed.ok) {
    return Promise.resolve(text(parsed.message, parsed.status));
  }

  return withGit(context, url, async (git) => {
    const scopes = await resolveSnapshotScopes(git, parsed.value.scope, {
      agentPatterns: context.agentPatterns,
      baseBranch: context.config.baseBranch,
    });
    const index =
      parsed.value.side === "after" ? scopes.afterIndex : scopes.beforeIndex;
    return json(
      await searchSnapshotPaths(
        git,
        snapshotFor(parsed.value.side, scopes),
        index,
        parsed.value.query,
        parsed.value.limit,
      ),
    );
  });
}
