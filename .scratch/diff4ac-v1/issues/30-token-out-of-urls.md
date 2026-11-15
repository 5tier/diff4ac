# 30: Keep the session token out of URLs and history

**What to build:** The session token is the only thing protecting source code served on localhost, but it leaks in several places:
- The launch URL is `http://127.0.0.1:<port>/?token=…`, and the token stays in the address bar, browser history and any copied link.
- `web/index.html` appends `?token=__TOKEN__` to the asset URLs, although `/assets/` is not authenticated.
- `web/api.ts` keeps the token in `sessionStorage`, with unguarded access, so a browser that blocks storage breaks module load.
- `/api/events` is opened as `/api/events?token=…` because EventSource cannot send headers.
- `src/server/security.ts` `requestToken` accepts `?token=` on every request.

This is finding 9 of `.scratch/reviews/architecture-review-2026-11-15.md`.

**Blocked by:** none. Ticket 29 runs in parallel and changes commit listing in `src/repository/commits.ts`, `src/changeset/commits.ts`, `src/server/routes/repository.ts`, `src/server/query.ts` (a `skip` param), `fetchCommits` in `web/api.ts` and the Commits panel. Stay out of those parts.

**Status:** done

- [x] Session cookie bootstrap:
  - `GET /?token=<valid>` sets an `HttpOnly; SameSite=Strict; Path=/` cookie and answers `303 See Other` to `/`, so the token never stays in the address bar or history.
  - Name the cookie per port (e.g. `diff4ac_<port>`): cookies are scoped by host, not port, so two diff4ac servers on 127.0.0.1 must not clobber each other.
  - Don't set `Secure` (it's plain http on loopback).
  - `GET /?token=<invalid>` stays 401 as today.
- [x] Authentication accepts, in order: the `x-diff4ac-token` header, `Authorization: Bearer`, or the session cookie. `?token=` is accepted **only** on the `/` bootstrap request; on any `/api/*` request it is ignored and gives 401 without a header or cookie. Keep timing-safe comparison, and keep the Host and Origin checks in front of everything. `SameSite=Strict` plus the existing Origin check covers CSRF for the review-mark POST; make sure the POST still requires an allowed Origin or no Origin, as today.
- [x] SPA:
  - It no longer reads or stores the token: remove `readToken`/`sessionToken` and the sessionStorage token key.
  - `fetch` calls rely on the cookie (same-origin, so `credentials: "same-origin"`, which is the default).
  - EventSource opens `/api/events` without a query token.
  - Remove `?token=__TOKEN__` from `web/index.html` and the `__TOKEN__` substitution in `src/server/static.ts` if nothing else needs it.
  - Any remaining sessionStorage/localStorage use stays wrapped in try/catch.
- [x] CLI: still prints and opens `http://127.0.0.1:<port>/?token=…`. The redirect strips it. The SSH-forward workflow (open the printed URL on another machine through `ssh -L`) must keep working, because the cookie is set for whatever loopback host the browser used.
- [x] Tests (temp HOMEs):
  - Server: bootstrap sets the cookie and 303s to `/`; the cookie authenticates `/`, `/api/*` and `/api/events`; `?token=` on `/api/pending` without header or cookie gives 401; a wrong cookie gives 401; header auth still works, since every existing test uses it; a cookie for another port's name doesn't authenticate; Origin checks are unchanged.
  - Playwright: open the printed URL. After load the address bar is exactly `http://127.0.0.1:<port>/`, `sessionStorage` holds no token, reload keeps working, the SSE refresh banner still works, and nothing requested `?token=` except the first navigation.
  - Run the full `bun test`, `typecheck` and `build`.
