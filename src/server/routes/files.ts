import { imageContentType, readContentAtRev } from "../../changeset/files";
import { buildScopedChangeFile } from "../../changeset/scope";
import { isFileVisible } from "../../filters";
import { annotateFile } from "../../review/marks";
import { SECURITY_HEADERS, json, text } from "../http";
import {
  parseFileContentRequest,
  parseFileDiffRequest,
  parseFilterSettings,
  parseScope,
  wantsFullContext,
} from "../query";
import { withGit } from "./shared";
import type { RouteRequest } from "./types";

function imageResponse(
  bytes: Buffer,
  contentType: string,
  method: string,
): Response {
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": String(bytes.byteLength),
    "Content-Disposition": "inline",
  };

  if (contentType === "image/svg+xml") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; sandbox";
  }

  return new Response(method === "HEAD" ? null : new Uint8Array(bytes), {
    status: 200,
    headers,
  });
}

export function handleFileDiff({
  context,
  url,
}: RouteRequest): Promise<Response> {
  const request = parseFileDiffRequest(url);
  if (!request.ok) {
    return Promise.resolve(text(request.message, request.status));
  }

  const scope = parseScope(url);
  if (!scope.ok) {
    return Promise.resolve(text(scope.message, scope.status));
  }

  const filters = parseFilterSettings(url, context.config.noise);
  if (!filters.ok) {
    return Promise.resolve(text(filters.message, filters.status));
  }

  return withGit(context, url, async (git) => {
    const file = await buildScopedChangeFile(
      git,
      scope.value,
      request.value.path,
      request.value.rev,
      {
        agentPatterns: context.agentPatterns,
        baseBranch: context.config.baseBranch,
        includeLargeDiffs: true,
        fullContext: wantsFullContext(url),
      },
    );
    if (!file || !isFileVisible(file, filters.value)) {
      return text("Not found", 404);
    }

    return json(
      annotateFile(file, context.reviewMarks, context.repositoryId),
    );
  });
}

export function handleFileContent({
  request: httpRequest,
  context,
  url,
}: RouteRequest): Promise<Response> {
  const request = parseFileContentRequest(url);
  if (!request.ok) {
    return Promise.resolve(text(request.message, request.status));
  }

  const scope = parseScope(url);
  if (!scope.ok) {
    return Promise.resolve(text(scope.message, scope.status));
  }

  const filters = parseFilterSettings(url, context.config.noise);
  if (!filters.ok) {
    return Promise.resolve(text(filters.message, filters.status));
  }

  return withGit(context, url, async (git) => {
    const file = await buildScopedChangeFile(
      git,
      scope.value,
      request.value.path,
      request.value.rev,
      {
        agentPatterns: context.agentPatterns,
        baseBranch: context.config.baseBranch,
        includeLargeDiffs: false,
        fullContext: wantsFullContext(url),
      },
    );
    if (!file || !isFileVisible(file, filters.value)) {
      return text("Not found", 404);
    }

    const annotated = annotateFile(
      file,
      context.reviewMarks,
      context.repositoryId,
    );
    const sidePath =
      request.value.rev === annotated.oldRev
        ? (annotated.oldPath ?? annotated.path)
        : annotated.path;
    const contentType = imageContentType(sidePath);
    if (!contentType) {
      return text("Not found", 404);
    }

    const bytes = await readContentAtRev(
      git,
      request.value.rev,
      sidePath,
    );
    if (!bytes) {
      return text("Not found", 404);
    }

    return imageResponse(bytes, contentType, httpRequest.method);
  });
}
