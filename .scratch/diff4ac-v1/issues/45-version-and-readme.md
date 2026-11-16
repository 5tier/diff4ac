# 45: A real version number and a README with install instructions

**What to build:** diff4ac can already be installed as a global CLI straight from a git address. This was checked on 2026-11-16 with a global `bun add -g git+file://…` into a throwaway prefix:
- only the runtime dependencies were installed;
- `diff4ac` was put on the PATH;
- the first run built the SPA into the install folder and served it.

Two things are missing before it is handed to anyone:
- it reports version `0.0.0`;
- there is no README.

`src/version.ts` already reads the version from `package.json`.

**Out of scope:** no remote is added and nothing is pushed. The repository is `git@github.com:5tier/diff4ac.git`; adding the remote and pushing are done by the person, not by the lane.

**Blocked by:** none.

**Status:** done

- [x] Set `package.json` `version` to `0.1.0`. Check that `diff4ac --version` and the startup banner show it. Any test that pins `0.0.0` should read the version from `package.json` instead of hard-coding the new number.
- [x] Leave `"private": true` in place: it only blocks `npm publish`, not git installs. Add a `description`, plus `"engines": { "bun": ">=1.4.4" }`, because the CLI runs on Bun.
- [x] First-run build in a read-only install folder, e.g. a global install owned by root: `ensureWebBuilt` must fail with a clear message that names the folder and says how to fix it. Today's spawn error is not enough. Add a test with an unwritable fake project root, using `DIFF4AC_PROJECT_ROOT`.
- [x] Write `README.md` in the repo root. Keep it short and in plain English.
  - **What it is:** one paragraph. diff4ac is a keyboard-driven, read-only diff viewer for reviewing changes made by coding agents. It is a local CLI that serves a web UI on localhost and never writes to the repository. Use the terms from `CONTEXT.md` (Change Set, Selection, Review Mark, Code View) without redefining them all.
  - **Requirements:** Bun (the minimum version from `engines`) and git.
  - **Install:**
    - `bun add -g github:5tier/diff4ac`;
    - a tagged version, `bun add -g github:5tier/diff4ac#v0.1.0`;
    - a private repository over SSH, `bun add -g git+ssh://git@github.com/5tier/diff4ac.git`.

    Say that the first run builds the web UI into the install folder, which takes a few seconds, and that updating means running the same command again.
  - **Use:**
    - `diff4ac [path]` and the options from `USAGE` in `src/args.ts`. Generate the list or copy it exactly; don't paraphrase flags.
    - What happens: it prints a URL with a one-time token and opens it, and the token becomes a session cookie.
    - Remote viewing over an SSH tunnel: `ssh -N -L 4700:127.0.0.1:4700 <user>@<host>`, then open the printed URL locally. The server only listens on 127.0.0.1.
  - **Keys:** a compact table of the main keys. Take it from the in-app help (`?`) and `shared/keymap.ts` so it can't drift; if practical, add a test that every key in the README table exists in the keymap.
  - **Configuration:** where settings and Review Marks are stored (`~/.diff4ac`), with one line on each config file.
  - **Development:**
    - `bun install`;
    - `bun run build`;
    - `bun src/cli.ts .`;
    - `bun test`, and `bun run playwright:install` for the browser tests;
    - `bun run typecheck`;
    - a pointer to `docs/architecture.md`, `docs/adr/` and `CONTEXT.md`.
  - **Releasing:** bump `version` in `package.json`, commit, then tag `v<version>`; users pin with `#v<version>`.
- [x] Verify the install the README describes:
  - a global install from the local repo (`bun add -g git+file://<repo>`) into a temp `BUN_INSTALL` and a temp HOME;
  - run `diff4ac --version` and `diff4ac <fixture> --port <n>`;
  - fetch the page and `assets/main.js`;
  - then delete the temp install.

  Report the commands and output. Don't touch the real `~/.bun` or `~/.diff4ac`.
- [x] Run plain `bun test`, typecheck and build.
