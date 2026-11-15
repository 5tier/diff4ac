# Architecture

diff4ac is split into three layers. Dependencies only ever point downward.

```
        web/  (browser)
          │
        shared/  (pure)
          ▲
          │
        src/  (Bun/Node: CLI and server)
```

## Layers

- **`shared/`** — pure code with no Bun, Node or DOM APIs: data types, the keymap,
  toolbar metadata, time windows, and the pure diff/changeset helpers. Both the
  server and the browser import it.
- **`src/`** — the Bun process: CLI, HTTP server, config loading, repository
  reading, Change Set construction, filters and Review Marks. It may import
  `src/` and `shared/`, never `web/`.
- **`web/`** — the single-page app: React panels, state and hooks, and the API
  client. It may import `web/` and `shared/`, never `src/`.

`test/layering.test.ts` enforces these rules by inspecting import specifiers.

## Server flow

The server is the only side that reads the Repository:

```
server routes
    ↓
changeset/        build Pending / commit / branch / Time Window Change Sets,
                  apply Filters, compute totals
    ↓
repository/       worktrees, branches, commits, status parsing, watcher
    ↓
git/gateway.ts    the only place that spawns git
```

- `src/server/` parses requests, resolves the Selection and returns JSON or file
  content. It does not talk to git directly.
- `src/changeset/` turns a Selection into files, hunks and totals.
- `src/repository/` reads Repository metadata and parses git output.
- `src/git/gateway.ts` (or `GitGateway`) is the single choke point for git. It
  only allows read-only subcommands, never writes to the Repository, and is what
  makes diff4ac's read-only guarantee testable.

Config (`src/config/`) and Review Marks (`src/review/`) sit alongside this flow:
the server reads them and exposes them through routes without writing to git.

## Browser

`web/` never sees git or the filesystem. It talks to the server over `/api/*`,
keeps UI state in `web/state/`, and renders `web/panels/`. Anything it shares
with the server (types, keymap, pure diff helpers) lives in `shared/`.
