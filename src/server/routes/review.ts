import { isSafeRelativePath } from "../../paths";
import { isValidContentHash } from "../../review/marks";
import { guardReviewMarkRequest } from "../../../shared/api-contract";
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

  const parsed = guardReviewMarkRequest(body, "");
  if (
    !parsed.ok ||
    !isSafeRelativePath(parsed.value.path) ||
    !isValidContentHash(parsed.value.contentHash)
  ) {
    return text(
      "Bad request: path, contentHash and reviewed are required",
      400,
    );
  }

  const { path, contentHash, reviewed } = parsed.value;
  context.reviewMarks.setMarked(
    context.repositoryId,
    path,
    contentHash,
    reviewed,
  );
  return json({ path, contentHash, reviewed });
}
