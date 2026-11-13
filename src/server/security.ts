import { timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = "x-diff4ac-token";

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function requestToken(request: Request, url: URL): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return request.headers.get(TOKEN_HEADER) ?? url.searchParams.get("token");
}

export function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false;
  }

  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(providedBytes, expectedBytes);
}

function allowedHosts(port: number): Set<string> {
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
}

function allowedOrigins(port: number): Set<string> {
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
}

export function isAllowedHost(host: string | null, port: number): boolean {
  return host !== null && allowedHosts(port).has(host.toLowerCase());
}

export function isAllowedOrigin(origin: string | null, port: number): boolean {
  if (origin === null) {
    return true;
  }
  return allowedOrigins(port).has(origin.toLowerCase());
}
