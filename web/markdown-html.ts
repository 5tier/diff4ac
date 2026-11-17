import type { Config } from "dompurify";

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isSafeRelativePath(path: string): boolean {
  if (
    !path ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    return false;
  }
  return !path.split("/").some((segment) => segment === ".." || segment === ".");
}

function stripSuffix(value: string): string {
  const hash = value.indexOf("#");
  const query = value.indexOf("?");
  const cut =
    hash === -1 ? query : query === -1 ? hash : Math.min(hash, query);
  return cut === -1 ? value : value.slice(0, cut);
}

/** Resolve a relative Markdown path against the file that contains it. */
export function resolveMarkdownPath(
  baseFile: string,
  rawPath: string,
): string | null {
  const decoded = decode(rawPath.trim());
  if (
    !decoded ||
    decoded.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(decoded) ||
    /^[A-Za-z]:/.test(decoded)
  ) {
    return null;
  }

  const base = baseFile.split("/");
  base.pop();
  const path = stripSuffix(decoded);
  const segments =
    path.startsWith("/") ? [] : base.filter((segment) => segment !== "");
  const rest = path.startsWith("/") ? path.slice(1) : path;

  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const resolved = segments.join("/");
  return resolved && isSafeRelativePath(resolved) ? resolved : null;
}

export interface MarkdownFileLink {
  readonly kind: "file";
  readonly path: string;
  readonly anchor: string | null;
}

export type MarkdownLink =
  | MarkdownFileLink
  | { readonly kind: "anchor"; readonly id: string }
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "drop" };

export function resolveMarkdownLink(
  baseFile: string,
  rawHref: string,
): MarkdownLink {
  const href = rawHref.trim();
  if (!href) {
    return { kind: "drop" };
  }
  if (href.startsWith("#")) {
    return { kind: "anchor", id: decode(href.slice(1)) };
  }
  const lower = href.toLowerCase();
  if (
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("mailto:")
  ) {
    return { kind: "external", href };
  }
  // Any other scheme, including javascript:, data: and protocol-relative URLs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return { kind: "drop" };
  }

  const hash = href.indexOf("#");
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const path = resolveMarkdownPath(baseFile, pathPart);
  if (!path) {
    return { kind: "drop" };
  }
  return {
    kind: "file",
    path,
    anchor: hash === -1 ? null : decode(href.slice(hash + 1)) || null,
  };
}

/**
 * A safe Snapshot-relative image path, or null for remote/unsafe images.
 * Callers show the alt text when this returns null.
 */
export function resolveMarkdownImage(
  baseFile: string,
  rawSrc: string,
): string | null {
  const src = rawSrc.trim();
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
    return null;
  }
  return resolveMarkdownPath(baseFile, src);
}

export function markdownHeadingId(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

/**
 * Keep the preview HTML safe: no scripts, iframes, forms, style attributes or
 * raw style tags. DOMPurify strips event handlers and unsafe URL schemes.
 */
export const MARKDOWN_SANITIZE_OPTIONS: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    "script",
    "style",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "form",
    "button",
    "textarea",
    "select",
    "option",
    "link",
    "meta",
    "base",
  ],
  FORBID_ATTR: ["style"],
  ALLOW_DATA_ATTR: false,
};
