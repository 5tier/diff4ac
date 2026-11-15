import { homedir } from "node:os";
import { join } from "node:path";
import {
  BUILT_IN_AGENT_PATTERNS,
  compileAgentPatterns,
} from "../agents";
import { loadConfig } from "../config/loader";
import { GitGateway } from "../git/gateway";
import { localBranchExists } from "../repository/branches";
import { repositoryIdentity } from "../repository/identity";
import { RepositoryWatcher } from "../repository/watcher";
import { primaryWorktreeRoot } from "../repository/worktrees";
import { ReviewMarkStore } from "../review/marks";
import type { ConfigInfo } from "../../shared/types";
import type { EventHub, RequestContext } from "./context";
import { text } from "./http";
import { routeFor } from "./routes";
import { DEFAULT_WEB_DIR, serveAsset } from "./static";
import {
  generateToken,
  isAllowedHost,
  isAllowedOrigin,
  requestToken,
  tokenMatches,
} from "./security";

export interface StartServerOptions {
  readonly repoPath: string;
  readonly port?: number;
  readonly token?: string;
  readonly webDir?: string;
  readonly stateDir?: string;
  readonly watchDebounceMs?: number;
  readonly homeDir?: string;
}

export interface RunningServer {
  readonly port: number;
  readonly url: string;
  readonly token: string;
  readonly server: Bun.Server<unknown>;
  readonly config: ConfigInfo;
  stop(): void;
}

function createEventHub(): EventHub {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
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
  const isStaticAsset = url.pathname.startsWith("/assets/");
  if (!isStaticAsset && !tokenMatches(requestToken(request, url), context.token)) {
    return text("Unauthorized: missing or invalid session token", 401);
  }

  const isReviewMarkWrite =
    request.method === "POST" && url.pathname === "/api/review-mark";
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    !isReviewMarkWrite
  ) {
    return text("Method not allowed", 405);
  }

  const route = routeFor(url.pathname);
  if (route) {
    if (route.method && route.method !== request.method) {
      return text("Method not allowed", 405);
    }
    return route.handler({ request, url, context });
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
  const homeDir = options.homeDir ?? homedir();
  const repositoryId = await repositoryIdentity(git);
  let config = loadConfig({
    homeDir,
    repositoryRoot: await primaryWorktreeRoot(git),
  });
  if (
    config.baseBranch &&
    !(await localBranchExists(git, config.baseBranch))
  ) {
    const missing = config.baseBranch;
    config = {
      ...config,
      baseBranch: null,
      diagnostics: [
        ...config.diagnostics,
        {
          file: config.baseBranchFile ?? "",
          field: "baseBranch",
          message: `branch "${missing}" not found; using auto-detection`,
        },
      ],
    };
  }
  const agentPatterns = compileAgentPatterns([
    ...BUILT_IN_AGENT_PATTERNS,
    ...config.agents,
  ]);
  const reviewMarks = new ReviewMarkStore(
    options.stateDir ?? join(homeDir, ".diff4ac"),
  );
  const events = createEventHub();
  const watcher = await RepositoryWatcher.start(git, {
    debounceMs: options.watchDebounceMs ?? 150,
    onChanged: () => events.emit(),
  });

  let server: Bun.Server<unknown>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: requestedPort,
    idleTimeout: 0,
    fetch: (request) =>
      handleRequest(request, {
        git,
        token,
        port: server.port ?? requestedPort,
        webDir,
        repositoryId,
        reviewMarks,
        events,
        config,
        agentPatterns,
      }),
  });

  const port = server.port ?? requestedPort;
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;

  return {
    port,
    url,
    token,
    server,
    config,
    stop() {
      watcher.stop();
      server.stop(true);
    },
  };
}
