# diff4ac

diff4ac is a keyboard-driven, read-only diff viewer for reviewing changes made by coding agents. It runs as a local CLI and serves a web UI on `127.0.0.1`. You pick a Selection (Pending, a commit, several commits, a branch or a Time Window); diff4ac builds the Change Set, and you read it as a diff or in Code View. It never writes to the Repository, and Review Marks are stored outside it.

## Requirements

- [Bun](https://bun.sh) 1.4.4 or newer
- git

## Install

```sh
bun add -g github:5tier/diff4ac
```

Pin a release:

```sh
bun add -g github:5tier/diff4ac#v0.1.0
```

Private repository over SSH:

```sh
bun add -g git+ssh://git@github.com/5tier/diff4ac.git
```

The first run builds the web UI into the install folder, which takes a few seconds. To update, run the same install command again.

## Use

```sh
diff4ac [path]
```

Options:

```text
Usage: diff4ac [path] [options]

Review a Repository's Pending changes in the browser.

Arguments:
  path                 Repository or path inside it (default: current directory)

Options:
  --port <port>        Port to listen on (default: an available port)
  --no-open            Do not open the browser
  --open               Open the browser (default)
  -h, --help           Show this help
  -v, --version        Show the version
```

diff4ac prints a URL containing a one-time token and opens it in the browser. The token is exchanged for a session cookie, so the URL in your address bar no longer carries it.

To view a remote machine, start diff4ac there with `--port 4700`, keep the server on its loopback interface and tunnel that port:

```sh
ssh -N -L 4700:127.0.0.1:4700 <user>@<host>
```

Then open the URL diff4ac printed there, locally. The server only listens on `127.0.0.1`.

## Keys

Press `?` in the app for the full, panel-specific list. These are the main keys:

<!-- keys:start -->
| Key | Action |
| --- | --- |
| `j` / `k` | Move down / up in the focused panel |
| `Enter` | Open the selected item |
| `1` / `2` / `3` / `4` / `0` | Focus Worktrees / Branches / Commits / Files / Diff |
| `Tab` | Cycle panels |
| `/` | Search the Change Set |
| `n` / `N` | Next / previous search match |
| `n` | Toggle Noise (review layout; while searching, `n` is Next match) |
| `]` / `[` | Next hunk / previous hunk (Diff) |
| `}` / `{` | Next file / previous file (Diff) |
| `Space` | Pick or unpick commit (Commits) |
| `v` | Start range pick (Commits) |
| `t` | Toggle Net Diff / Commit Stack (Commits) |
| `w` | Choose a Time Window (Commits) |
| `a` | Filter commits by Agent (Commits) |
| `f` | Open Filters |
| `r` | Refresh the Repository |
| `s` | Toggle side-by-side diff |
| `c` | Toggle full file / changed hunks only |
| `m` | Toggle a Review Mark |
| `x` | Load a large diff |
| `T` | Toggle the folder tree |
| `o` | Toggle Code View |
| `b` | Code View: switch after / before Snapshot |
| `Ctrl+P` | Find file (Code View) |
| `D` | Cycle the theme |
| `?` | Show keybindings |
<!-- keys:end -->

## Configuration

- `~/.diff4ac/config.json` — global settings: Base Branch, keybinding overrides, Agent patterns, Noise patterns and theme.
- `~/.diff4ac/review-marks.json` — Review Marks, keyed by Repository and content hash.
- `.diff4ac.json` in a Repository — per-repository overrides of the same settings.

## Development

```sh
bun install
bun run build
bun src/cli.ts .
bun test
bun run playwright:install   # once, for the browser tests
bun run typecheck
```

See `docs/architecture.md` for the layering, `docs/adr/` for decisions, and `CONTEXT.md` for the vocabulary.

## Releasing

Bump `version` in `package.json`, commit, then tag `v<version>`. Users pin a release with `#v<version>`.
