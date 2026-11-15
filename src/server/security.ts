import { timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = "x-diff4ac-token";
const COOKIE_PREFIX = "diff4ac_";

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function sessionCookieName(port: number): string {
  return `${COOKIE_PREFIX}${port}`;
}

export function requestToken(request: Request): string | null {
  const header = request.headers.get(TOKEN_HEADER);
  if (header !== null) {
    return header;
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return null;
}

export function requestCookieToken(
  request: Request,
  port: number,
): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }

  const name = sessionCookieName(port);
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
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
