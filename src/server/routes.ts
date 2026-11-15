import { serveIndex } from "./static";
import {
  handleBranch,
  handleCommit,
  handleCommitSet,
  handlePending,
  handleTimeWindow,
} from "./routes/change-sets";
import {
  handleFileContent,
  handleFileDiff,
} from "./routes/files";
import {
  handleBranches,
  handleCommits,
  handleWorktrees,
} from "./routes/repository";
import { handleReviewMark } from "./routes/review";
import {
  handleConfig,
  handleEvents,
  handleSession,
} from "./routes/session";
import type { Route } from "./routes/types";

export const routes: readonly Route[] = [
  { path: "/api/pending", handler: handlePending },
  { path: "/api/commit", handler: handleCommit },
  { path: "/api/commit-set", handler: handleCommitSet },
  { path: "/api/time-window", handler: handleTimeWindow },
  { path: "/api/branch", handler: handleBranch },
  { path: "/api/file-diff", handler: handleFileDiff },
  { path: "/api/file-content", handler: handleFileContent },
  { path: "/api/worktrees", handler: handleWorktrees },
  { path: "/api/branches", handler: handleBranches },
  { path: "/api/commits", handler: handleCommits },
  { path: "/api/review-mark", method: "POST", handler: handleReviewMark },
  { path: "/api/session", handler: handleSession },
  { path: "/api/config", handler: handleConfig },
  { path: "/api/events", method: "GET", handler: handleEvents },
  {
    path: "/",
    handler: ({ context, request }) => serveIndex(context, request.method),
  },
  {
    path: "/index.html",
    handler: ({ context, request }) => serveIndex(context, request.method),
  },
];

export function routeFor(pathname: string): Route | undefined {
  return routes.find((route) => route.path === pathname);
}
