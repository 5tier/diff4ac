import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import {
  BUILT_IN_AGENT_PATTERNS,
  compileAgentPatterns,
  type CompiledAgentPattern,
} from "../agents";
import { buildBranchChangeSet } from "../changeset/branch";
import { buildCommitChangeSet } from "../changeset/commit";
import {
  buildCommitsChangeSet,
  buildTimeWindowChangeSet,
  NonContiguousNetDiffError,
} from "../changeset/commits";
import { buildPendingChangeSet } from "../changeset/pending";
import { loadConfig } from "../config/loader";
import { applyFilters, isValidGlob, type FilterSettings } from "../filters";
import { GitGateway } from "../git/gateway";
import {
  listBranches,
  localBranchExists,
  UnknownBranchError,
} from "../repository/branches";
import { listCommits } from "../repository/commits";
import { repositoryIdentity } from "../repository/identity";
import { RepositoryWatcher } from "../repository/watcher";
import {
  listWorktrees,
  openWorktree,
  primaryWorktreeRoot,
  UnknownWorktreeError,
} from "../repository/worktrees";
import {
  isTimeWindowPreset,
  parseTimeWindowInstant,
  timeWindowLabel,
} from "../time-windows";
import {
  annotateChangeSet,
  isValidContentHash,
  isValidReviewPath,
  ReviewMarkStore,
} from "../review/marks";
import type {
  ChangeSet,
  ChangeViewMode,
  ConfigInfo,
  SessionInfo,
  TimeWindow,
} from "../types";
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

function gitApiFailure(error: unknown): Response {
  if (error instanceof UnknownWorktreeError) {
    return text(error.message, 404);
  }
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

async function gitForRequest(
  context: RequestContext,
  url: URL,
): Promise<GitGateway> {
  const worktreePath = url.searchParams.get("worktree");
  return worktreePath
    ? openWorktree(context.git, worktreePath)
    : context.git;
}

function parseFilterSettings(
  url: URL,
  noisePatterns: readonly string[],
): FilterSettings | null {
  const disabledExtensions = url.searchParams
    .getAll("ext")
    .map((extension) => extension.trim().toLowerCase());
  if (
    !disabledExtensions.every(
      (extension) =>
        extension === "" ||
        (extension.startsWith(".") &&
          extension.length <= 64 &&
          !/[/\\\0\r\n]/.test(extension)),
    )
  ) {
    return null;
  }

  const parseGlobs = (name: string) =>
    url.searchParams
      .getAll(name)
      .map((pattern) => pattern.trim())
      .filter(Boolean);
  const includeGlobs = parseGlobs("include");
  const excludeGlobs = parseGlobs("exclude");

  if (
    !includeGlobs.every(isValidGlob) ||
    !excludeGlobs.every(isValidGlob)
  ) {
    return null;
  }

  return {
    disabledExtensions,
    includeGlobs,
    excludeGlobs,
    hideNoise: url.searchParams.get("noise") !== "0",
    noisePatterns,
  };
}

function reviewJson(
  changeSet: ChangeSet,
  context: RequestContext,
  url: URL,
): Response {
  const filters = parseFilterSettings(url, context.config.noise);
  if (!filters) {
    return text("Bad request: invalid filter", 400);
  }

  return json(
    annotateChangeSet(
      applyFilters(changeSet, filters),
      context.reviewMarks,
      context.repositoryId,
    ),
  );
}

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

interface EventHub {
  subscribe(listener: () => void): () => void;
  emit(): void;
}

interface RequestContext {
  readonly git: GitGateway;
  readonly token: string;
  readonly port: number;
  readonly webDir: string;
  readonly repositoryId: string;
  readonly reviewMarks: ReviewMarkStore;
  readonly config: ConfigInfo;
  readonly agentPatterns: readonly CompiledAgentPattern[];
  readonly events: EventHub;
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

function serveEvents(context: RequestContext, request: Request): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = context.events.subscribe(() => {
        send("event: repository-changed\ndata: {}\n\n");
      });
      const ping = setInterval(() => send(": ping\n\n"), 15_000);

      cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
      send(": connected\n\n");
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
    },
  });
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

function resolveAssetPath(
  webDir: string,
  pathname: string,
): string | null {
  let name: string;
  try {
    name = decodeURIComponent(pathname.slice("/assets/".length));
  } catch {
    return null;
  }

  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes("..")
  ) {
    return null;
  }

  const assetsDir = join(webDir, "assets");
  try {
    const assetsReal = realpathSync(assetsDir);
    const candidateReal = realpathSync(join(assetsDir, name));
    if (!candidateReal.startsWith(`${assetsReal}${sep}`)) {
      return null;
    }
    const relative = candidateReal.slice(assetsReal.length + sep.length);
    if (!relative || relative.includes(sep)) {
      return null;
    }
    if (!statSync(candidateReal).isFile()) {
      return null;
    }
    return candidateReal;
  } catch {
    return null;
  }
}

function serveAsset(
  context: RequestContext,
  pathname: string,
  method: string,
): Response {
  const assetPath = resolveAssetPath(context.webDir, pathname);
  if (!assetPath) {
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

  if (url.pathname === "/api/review-mark") {
    if (request.method !== "POST") {
      return text("Method not allowed", 405);
    }

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

  if (url.pathname === "/api/events") {
    if (request.method !== "GET") {
      return text("Method not allowed", 405);
    }
    return serveEvents(context, request);
  }

  if (url.pathname === "/api/config") {
    return json(context.config);
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
    try {
      const git = await gitForRequest(context, url);
      return reviewJson(await buildPendingChangeSet(git), context, url);
    } catch (error) {
      return gitApiFailure(error);
    }
  }

  if (url.pathname === "/api/branches") {
    try {
      const git = await gitForRequest(context, url);
      return json(await listBranches(git, context.config.baseBranch));
    } catch (error) {
      return gitApiFailure(error);
    }
  }

  if (url.pathname === "/api/branch") {
    const name = url.searchParams.get("name");
    if (!name) {
      return text("Bad request: a branch name is required", 400);
    }

    try {
      const git = await gitForRequest(context, url);
      return reviewJson(
        await buildBranchChangeSet(git, name, context.config.baseBranch),
        context,
        url,
      );
    } catch (error) {
      if (error instanceof UnknownBranchError) {
        return text(error.message, 404);
      }
      return gitApiFailure(error);
    }
  }

  if (url.pathname === "/api/commits") {
    try {
      const git = await gitForRequest(context, url);
      const agent = url.searchParams.get("agent") ?? undefined;
      return json(
        await listCommits(git, {
          agentPatterns: context.agentPatterns,
          agent: agent || undefined,
        }),
      );
    } catch (error) {
      return gitApiFailure(error);
    }
  }

  if (url.pathname === "/api/commit") {
    const hash = url.searchParams.get("hash");
    if (!hash || !/^[0-9a-fA-F]{4,64}$/.test(hash)) {
      return text("Bad request: a commit hash is required", 400);
    }

    try {
      const git = await gitForRequest(context, url);
      return reviewJson(
        await buildCommitChangeSet(git, hash, {
          agentPatterns: context.agentPatterns,
        }),
        context,
        url,
      );
    } catch (error) {
      return gitApiFailure(error);
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
      const git = await gitForRequest(context, url);
      return reviewJson(
        await buildCommitsChangeSet(git, hashes, mode, {
          agentPatterns: context.agentPatterns,
        }),
        context,
        url,
      );
    } catch (error) {
      return gitApiFailure(error);
    }
  }

  if (url.pathname === "/api/time-window") {
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    const preset = url.searchParams.get("preset") ?? "";
    const requestedMode = url.searchParams.get("mode") ?? "auto";
    const agent = url.searchParams.get("agent") ?? undefined;

    const startMs = parseTimeWindowInstant(start);
    const endMs = parseTimeWindowInstant(end);

    if (
      startMs === null ||
      endMs === null ||
      startMs >= endMs ||
      !isTimeWindowPreset(preset)
    ) {
      return text(
        "Bad request: start, end and a preset are required",
        400,
      );
    }

    if (
      requestedMode !== "auto" &&
      requestedMode !== "net" &&
      requestedMode !== "stack"
    ) {
      return text("Bad request: mode must be auto, net or stack", 400);
    }

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    const window: TimeWindow = {
      preset,
      start: startIso,
      end: endIso,
      label: timeWindowLabel(preset, startIso, endIso),
    };

    try {
      const git = await gitForRequest(context, url);
      return reviewJson(
        await buildTimeWindowChangeSet(
          git,
          window,
          requestedMode as ChangeViewMode | "auto",
          {
            agentPatterns: context.agentPatterns,
            agent: agent || undefined,
          },
        ),
        context,
        url,
      );
    } catch (error) {
      return gitApiFailure(error);
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
