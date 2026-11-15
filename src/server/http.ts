export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:",
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { ...SECURITY_HEADERS },
  });
}

export function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
