export interface CliOptions {
  readonly path: string;
  readonly port: number | undefined;
  readonly open: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`invalid port "${raw}"; expected an integer from 0 to 65535`);
  }
  return port;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let path = ".";
  let port: number | undefined;
  let open = true;
  let help = false;
  let version = false;
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      version = true;
      continue;
    }

    if (arg === "--no-open") {
      open = false;
      continue;
    }

    if (arg === "--open") {
      open = true;
      continue;
    }

    if (arg === "--port") {
      const raw = argv[++index];
      if (raw === undefined) {
        throw new UsageError("--port needs a value");
      }
      port = parsePort(raw);
      continue;
    }

    if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new UsageError(`unknown option "${arg}"`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new UsageError("only one path may be given");
  }

  path = positionals[0] ?? path;

  return { path, port, open, help, version };
}

export const USAGE = `Usage: diff4ac [path] [options]

Review a Repository's Pending changes in the browser.

Arguments:
  path                 Repository or path inside it (default: current directory)

Options:
  --port <port>        Port to listen on (default: an available port)
  --no-open            Do not open the browser
  --open               Open the browser (default)
  -h, --help           Show this help
  -v, --version        Show the version
`;
