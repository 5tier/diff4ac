import type { HighlighterCore, LanguageRegistration } from "shiki/types";
import type { Hunk } from "../shared/types";
import type { HunkHighlight, TokenSpan } from "../shared/diff/rows";

type LanguageModule = { readonly default: readonly LanguageRegistration[] };
type LanguageLoader = () => Promise<LanguageModule>;

const LANGUAGE_LOADERS: Readonly<Record<string, LanguageLoader>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  less: () => import("@shikijs/langs/less"),
  html: () => import("@shikijs/langs/html"),
  markdown: () => import("@shikijs/langs/markdown"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  sql: () => import("@shikijs/langs/sql"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  csharp: () => import("@shikijs/langs/csharp"),
  xml: () => import("@shikijs/langs/xml"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  lua: () => import("@shikijs/langs/lua"),
  dart: () => import("@shikijs/langs/dart"),
  elixir: () => import("@shikijs/langs/elixir"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  make: () => import("@shikijs/langs/make"),
};

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  cs: "csharp",
  xml: "xml",
  svg: "xml",
  lua: "lua",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  diff: "diff",
  patch: "diff",
};

const FILENAME_LANGUAGES: Readonly<Record<string, string>> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "make",
};

export function languageForPath(path: string): string | null {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  const byFilename = FILENAME_LANGUAGES[name];
  if (byFilename) {
    return byFilename;
  }

  const dot = name.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  return EXTENSION_LANGUAGES[name.slice(dot + 1)] ?? null;
}

export function supportsLanguage(language: string): boolean {
  return language in LANGUAGE_LOADERS;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();
const languagePromises = new Map<string, Promise<void>>();
const tokenCache = new Map<string, readonly (readonly TokenSpan[])[]>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [core, engine, dark, light] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/github-dark"),
      import("@shikijs/themes/github-light"),
    ]);
    return core.createHighlighterCore({
      engine: engine.createJavaScriptRegexEngine(),
      themes: [dark.default, light.default],
    });
  })();
  return highlighterPromise;
}

async function ensureLanguage(language: string): Promise<boolean> {
  if (loadedLanguages.has(language)) {
    return true;
  }

  const loader = LANGUAGE_LOADERS[language];
  if (!loader) {
    return false;
  }

  let pending = languagePromises.get(language);
  if (!pending) {
    pending = (async () => {
      const highlighter = await getHighlighter();
      const module = await loader();
      await highlighter.loadLanguage(...module.default);
      loadedLanguages.add(language);
    })();
    languagePromises.set(language, pending);
  }

  try {
    await pending;
    return true;
  } catch {
    languagePromises.delete(language);
    return false;
  }
}

async function tokenize(
  code: string,
  language: string,
): Promise<readonly (readonly TokenSpan[])[]> {
  if (code === "") {
    return [];
  }

  const key = `${language}\u0000${code}`;
  const cached = tokenCache.get(key);
  if (cached) {
    return cached;
  }

  const highlighter = await getHighlighter();
  const result = highlighter.codeToTokens(code, {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });

  const lines = result.tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      ...(token.htmlStyle
        ? { style: token.htmlStyle as Readonly<Record<string, string>> }
        : {}),
    })),
  );

  tokenCache.set(key, lines);
  if (tokenCache.size > 500) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) {
      tokenCache.delete(oldest);
    }
  }
  return lines;
}

function emptyHighlight(hunk: Hunk): HunkHighlight {
  return {
    old: hunk.lines
      .filter((line) => line.type !== "add")
      .map(() => null),
    new: hunk.lines
      .filter((line) => line.type !== "delete")
      .map(() => null),
  };
}

async function highlightHunk(
  hunk: Hunk,
  language: string,
): Promise<HunkHighlight> {
  const oldText = hunk.lines
    .filter((line) => line.type !== "add")
    .map((line) => line.content)
    .join("\n");
  const newText = hunk.lines
    .filter((line) => line.type !== "delete")
    .map((line) => line.content)
    .join("\n");

  const [oldTokens, newTokens] = await Promise.all([
    tokenize(oldText, language),
    tokenize(newText, language),
  ]);

  return {
    old: hunk.lines
      .filter((line) => line.type !== "add")
      .map((_, index) => oldTokens[index] ?? null),
    new: hunk.lines
      .filter((line) => line.type !== "delete")
      .map((_, index) => newTokens[index] ?? null),
  };
}

export async function highlightHunks(
  hunks: readonly Hunk[],
  language: string,
): Promise<readonly HunkHighlight[]> {
  if (!(await ensureLanguage(language))) {
    return hunks.map(emptyHighlight);
  }

  return Promise.all(hunks.map((hunk) => highlightHunk(hunk, language)));
}

/** Syntax-highlight a whole file as one token list per line. */
export async function highlightLines(
  text: string,
  language: string | null,
): Promise<readonly (readonly TokenSpan[])[] | null> {
  if (!language || !(await ensureLanguage(language))) {
    return null;
  }
  return tokenize(text, language);
}
