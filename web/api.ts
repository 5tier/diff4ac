import type { ChangeSet } from "../src/types";

const TOKEN_KEY = "diff4ac-token";

function readToken(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");

  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl;
  }

  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export const sessionToken = readToken();

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { "x-diff4ac-token": sessionToken },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export function fetchPending(signal?: AbortSignal): Promise<ChangeSet> {
  return getJson<ChangeSet>("/api/pending", signal);
}
