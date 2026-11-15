import {
  isValidContentHash,
  isValidReviewPath,
} from "../../review/marks";
import { json, text } from "../http";
import type { RouteRequest } from "./types";

export async function handleReviewMark({
  request,
  context,
}: RouteRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return text("Bad request: a JSON body is required", 400);
  }

  const record =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const path = record.path;
  const contentHash = record.contentHash;
  const reviewed = record.reviewed;

  if (
    typeof path !== "string" ||
    !isValidReviewPath(path) ||
    typeof contentHash !== "string" ||
    !isValidContentHash(contentHash) ||
    typeof reviewed !== "boolean"
  ) {
    return text(
      "Bad request: path, contentHash and reviewed are required",
      400,
    );
  }

  context.reviewMarks.setMarked(
    context.repositoryId,
    path,
    contentHash,
    reviewed,
  );
  return json({ path, contentHash, reviewed });
}
