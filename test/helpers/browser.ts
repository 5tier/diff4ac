import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { startFixtureServer, type FixtureServer } from "./server";
import {
  createFixtureRepo,
  type FixtureCheckout,
  type FixtureRepo,
} from "./fixture";
import { registerCleanup, registerSuiteCleanup } from "./cleanup";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
let spaBuildChecked = false;

export async function ensureSpaBuilt(): Promise<void> {
  if (spaBuildChecked) {
    return;
  }
  spaBuildChecked = true;
  if (existsSync(join(PROJECT_ROOT, "dist", "web", "assets", "main.js"))) {
    return;
  }
  const build = Bun.spawnSync({
    cmd: [process.execPath, join(PROJECT_ROOT, "scripts", "build-web.ts")],
    cwd: PROJECT_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) {
    throw new Error(`building the SPA failed: ${build.stderr.toString()}`);
  }
}

let browserPromise: Promise<Browser> | null = null;

async function createChromium(): Promise<Browser> {
  const attempts: Array<() => Promise<Browser>> = [
    () => chromium.launch({ headless: true }),
    () => chromium.launch({ headless: true, channel: "chrome" }),
    () =>
      chromium.launch({
        headless: true,
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      }),
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `could not launch a Playwright browser; run \`bunx playwright install chromium\`: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** One Chromium per test process; closed by the suite cleanup. */
export function launchChromium(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = createChromium();
    const promise = browserPromise;
    registerSuiteCleanup(async () => {
      const browser = await promise;
      await browser.close();
    });
  }
  return browserPromise;
}

export interface ReviewFixture {
  readonly repo: FixtureRepo;
  readonly linkedWorktree: FixtureCheckout;
}

/**
 * The fixture used by most Playwright feature files. Each caller owns its own
 * Repository, so a mutating test cannot leak state into the next one.
 */
export function createReviewFixture(): ReviewFixture {
  const repo = createFixtureRepo();
  const longFile = `${Array.from(
    { length: 220 },
    (_, index) => `line ${index + 1}`,
  ).join("\n")}\n`;

  repo.write("src/alpha.ts", longFile);
  repo.write("src/beta.ts", "beta one\n");
  repo.commit("first commit");

  repo.write("src/alpha.ts", `${longFile}changed once\n`);
  repo.write("src/beta.ts", "beta two\n");
  repo.commit("second commit", {
    trailers: ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"],
  });

  repo.write("src/beta.ts", "beta three\n");
  repo.commit("third commit");

  const linkedWorktree = repo.addWorktree("agent", { branch: "agent-work" });
  linkedWorktree.write("src/linked.ts", "linked history\n");
  linkedWorktree.commit("linked history");

  repo.write("src/main-only.ts", "main only\n");
  repo.commit("main after linked");
  repo.git(["branch", "doomed"]);

  repo.write("src/alpha.ts", `${longFile}changed again\n`);
  repo.write("src/gamma.ts", "pending gamma\n");
  repo.write("bun.lock", "lockfile\n");
  linkedWorktree.write("src/linked.ts", "linked pending\n");

  repo.write(".git/info/exclude", ".diff4ac.json\n");
  repo.write(
    ".diff4ac.json",
    `${JSON.stringify({ keybindings: { "branches.moveDown": "b" } })}\n`,
  );

  return { repo, linkedWorktree };
}

export interface BrowserSessionOptions {
  readonly browser?: Browser;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly commitPageSize?: number;
  readonly waitForSelector?: string;
}

export interface BrowserSession {
  readonly fixture: FixtureServer;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly running: FixtureServer["running"];
  readonly repo: FixtureRepo;
}

/** Start a temp-HOME server for `repo` and open a cookie-bootstrapped page. */
export async function startBrowserSession(
  repo: FixtureRepo,
  options: BrowserSessionOptions = {},
): Promise<BrowserSession> {
  await ensureSpaBuilt();
  const browser = options.browser ?? (await launchChromium());
  const fixture = await startFixtureServer({
    repo,
    ...(options.commitPageSize !== undefined
      ? { commitPageSize: options.commitPageSize }
      : {}),
  });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1200, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(fixture.running.url);
  await page.waitForSelector(options.waitForSelector ?? ".file-row");
  registerCleanup(async () => {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  });
  return {
    fixture,
    browser,
    context,
    page,
    running: fixture.running,
    repo,
  };
}
