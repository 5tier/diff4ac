import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBranchChangeSet } from "../changeset/branch";
import { buildCommitChangeSet } from "../changeset/commit";
import {
  buildCommitsChangeSet,
  NonContiguousNetDiffError,
} from "../changeset/commits";
import { buildPendingChangeSet } from "../changeset/pending";
import { GitGateway } from "../git/gateway";
import {
  listBranches,
  UnknownBranchError,
} from "../repository/branches";
import { listCommits } from "../repository/commits";
import {
  listWorktrees,
  openWorktree,
  UnknownWorktreeError,
} from "../repository/worktrees";
import type { SessionInfo } from "../types";
import { VERSION } from "../version";
import {
  generateToken,
  isAllowedHost,
  isAllowedOrigin,
  requestToken,
  tokenMatches,
} from "./security";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const DEFAULT_WEB_DIR = join(PROJECT_ROOT, "dist", "web");

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { ...SECURITY_HEADERS },
  });
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export interface StartServerOptions {
  readonly repoPath: string;
  readonly port?: number;
  readonly token?: string;
  readonly webDir?: string;
}

export interface RunningServer {
  readonly port: number;
  readonly url: string;
  readonly token: string;
  readonly server: Bun.Server<unknown>;
  stop(): void;
}

interface RequestContext {
  readonly git: GitGateway;
  readonly token: string;
  readonly port: number;
  readonly webDir: string;
}

function serveIndex(context: RequestContext, method: string): Response {
  const indexPath = join(context.webDir, "index.html");
  if (!existsSync(indexPath)) {
    return text(
      "diff4ac: the SPA has not been built. Run `bun run build` first.",
      500,
    );
  }

  const html = readFileSync(indexPath, "utf8").replaceAll(
    "__TOKEN__",
    encodeURIComponent(context.token),
  );

  return new Response(method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function serveAsset(
  context: RequestContext,
  pathname: string,
  method: string,
): Response {
  const name = decodeURIComponent(pathname.slice("/assets/".length));
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return text("Not found", 404);
  }

  const assetPath = join(context.webDir, "assets", name);
  if (!existsSync(assetPath)) {
    return text("Not found", 404);
  }

  const headers = { ...SECURITY_HEADERS };
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(Bun.file(assetPath), { status: 200, headers });
}

async function handleRequest(
  request: Request,
  context: RequestContext,
): Promise<Response> {
  if (!isAllowedHost(request.headers.get("host"), context.port)) {
    return text("Forbidden: unexpected Host header", 403);
  }

  if (!isAllowedOrigin(request.headers.get("origin"), context.port)) {
    return text("Forbidden: unexpected Origin header", 403);
  }

  const url = new URL(request.url);
  if (!tokenMatches(requestToken(request, url), context.token)) {
    return text("Unauthorized: missing or invalid session token", 401);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return text("Method not allowed", 405);
  }

  if (url.pathname === "/api/session") {
    const session: SessionInfo = {
      worktree: {
        path: context.git.worktreeRoot,
        branch: await context.git.currentBranch(),
      },
      version: VERSION,
    };
    return json(session);
  }

  if (url.pathname === "/api/worktrees") {
    try {
      return json(await listWorktrees(context.git));
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/pending") {
    const worktreePath = url.searchParams.get("worktree");

    try {
      const git = worktreePath
        ? await openWorktree(context.git, worktreePath)
        : context.git;
      return json(await buildPendingChangeSet(git));
    } catch (error) {
      if (error instanceof UnknownWorktreeError) {
        return text(error.message, 404);
      }
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/branches") {
    try {
      return json(await listBranches(context.git));
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/branch") {
    const name = url.searchParams.get("name");
    if (!name) {
      return text("Bad request: a branch name is required", 400);
    }

    try {
      return json(await buildBranchChangeSet(context.git, name));
    } catch (error) {
      if (error instanceof UnknownBranchError) {
        return text(error.message, 404);
      }
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/commits") {
    try {
      return json(await listCommits(context.git));
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/commit") {
    const hash = url.searchParams.get("hash");
    if (!hash || !/^[0-9a-fA-F]{4,64}$/.test(hash)) {
      return text("Bad request: a commit hash is required", 400);
    }

    try {
      return json(await buildCommitChangeSet(context.git, hash));
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/commit-set") {
    const rawHashes = url.searchParams.get("hashes") ?? "";
    const hashes = rawHashes.split(",").filter(Boolean);
    const mode = url.searchParams.get("mode") ?? "net";
    const validHash = /^[0-9a-fA-F]{4,64}$/;

    if (
      hashes.length === 0 ||
      !hashes.every((hash) => validHash.test(hash)) ||
      (mode !== "net" && mode !== "stack")
    ) {
      return text(
        "Bad request: commit hashes and a mode of net or stack are required",
        400,
      );
    }

    try {
      return json(await buildCommitsChangeSet(context.git, hashes, mode));
    } catch (error) {
      if (error instanceof NonContiguousNetDiffError) {
        return text(error.message, 400);
      }
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return serveIndex(context, request.method);
  }

  if (url.pathname.startsWith("/assets/")) {
    return serveAsset(context, url.pathname, request.method);
  }

  return text("Not found", 404);
}

export async function startServer(
  options: StartServerOptions,
): Promise<RunningServer> {
  const git = await GitGateway.open(options.repoPath);
  const token = options.token ?? generateToken();
  const webDir = options.webDir ?? DEFAULT_WEB_DIR;
  const requestedPort = options.port ?? 0;

  let server: Bun.Server<unknown>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: requestedPort,
    fetch: (request) =>
      handleRequest(request, {
        git,
        token,
        port: server.port ?? requestedPort,
        webDir,
      }),
  });

  const port = server.port ?? requestedPort;
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;

  return {
    port,
    url,
    token,
    server,
    stop() {
      server.stop(true);
    },
  };
}
