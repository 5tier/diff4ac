import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { RequestContext } from "./context";
import { SECURITY_HEADERS, text } from "./http";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

export const DEFAULT_WEB_DIR = join(PROJECT_ROOT, "dist", "web");

export function serveIndex(
  context: RequestContext,
  method: string,
): Response {
  const indexPath = join(context.webDir, "index.html");
  if (!existsSync(indexPath)) {
    return text(
      "diff4ac: the SPA has not been built. Run `bun run build` first.",
      500,
    );
  }

  const html = readFileSync(indexPath, "utf8");

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

export function serveAsset(
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
