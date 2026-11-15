import type { SessionInfo } from "../../../shared/types";
import { VERSION } from "../../version";
import { SECURITY_HEADERS, json } from "../http";
import type { RouteRequest } from "./types";

export function handleConfig({ context }: RouteRequest): Response {
  return json({ ...context.config, watch: context.watchStatus() });
}

export async function handleSession({
  context,
}: RouteRequest): Promise<Response> {
  const session: SessionInfo = {
    worktree: {
      path: context.git.worktreeRoot,
      branch: await context.git.currentBranch(),
    },
    version: VERSION,
    watch: context.watchStatus(),
  };
  return json(session);
}

export function handleEvents({
  context,
  request,
}: RouteRequest): Response {
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
