import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { SnapshotSide } from "../../shared/types";
import { snapshotRawUrl, type FileRequestContext } from "../api";
import {
  CODE_HIGHLIGHT_LINE_LIMIT,
  codeLineCount,
  highlightLines,
  languageForPath,
  supportsLanguage,
} from "../highlight";
import {
  MARKDOWN_SANITIZE_OPTIONS,
  markdownHeadingId,
  resolveMarkdownImage,
  resolveMarkdownLink,
} from "../markdown-html";

function setTokenStyle(element: HTMLElement, style: Readonly<Record<string, string>>): void {
  for (const [property, value] of Object.entries(style)) {
    element.style.setProperty(property, value);
  }
}

function assignHeadingIds(root: DocumentFragment): void {
  const used = new Set<string>();
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const base = heading.id || markdownHeadingId(heading.textContent ?? "");
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix++;
    }
    used.add(id);
    heading.id = id;
  }
}

function rewriteLinks(root: DocumentFragment, baseFile: string): void {
  for (const anchor of root.querySelectorAll("a")) {
    const href = anchor.getAttribute("href") ?? "";
    const link = resolveMarkdownLink(baseFile, href);
    switch (link.kind) {
      case "external":
        anchor.setAttribute("href", link.href);
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
        break;
      case "anchor":
        anchor.setAttribute("href", `#${link.id}`);
        anchor.dataset.anchorId = link.id;
        break;
      case "file":
        anchor.removeAttribute("href");
        anchor.dataset.snapshotPath = link.path;
        if (link.anchor) {
          anchor.dataset.snapshotAnchor = link.anchor;
        }
        break;
      case "drop":
        anchor.removeAttribute("href");
        break;
    }
  }
}

function rewriteImages(
  root: DocumentFragment,
  baseFile: string,
  target: FileRequestContext,
  side: SnapshotSide,
): void {
  for (const image of root.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const resolved = resolveMarkdownImage(baseFile, src);
    if (!resolved) {
      const replacement = document.createElement("span");
      replacement.className = "markdown-image-alt";
      replacement.textContent = image.getAttribute("alt") || "image";
      image.replaceWith(replacement);
      continue;
    }
    image.setAttribute("src", snapshotRawUrl(target, side, resolved));
    image.setAttribute("loading", "lazy");
    image.removeAttribute("srcset");
  }
}

async function highlightCodeBlocks(root: DocumentFragment): Promise<void> {
  for (const code of root.querySelectorAll("pre code")) {
    const rawLanguage = /(?:^|\s)language-([\w+-]+)/.exec(
      code.getAttribute("class") ?? "",
    )?.[1];
    if (!rawLanguage) {
      continue;
    }
    const language = supportsLanguage(rawLanguage)
      ? rawLanguage
      : languageForPath(`code.${rawLanguage}`);
    if (!language) {
      continue;
    }
    const text = code.textContent ?? "";
    const lines = await highlightLines(text, language);
    if (!lines) {
      continue;
    }
    const fragment = document.createDocumentFragment();
    lines.forEach((tokens, index) => {
      for (const token of tokens) {
        const span = document.createElement("span");
        span.className = "syntax-token";
        if (token.style) {
          setTokenStyle(span, token.style);
        }
        span.textContent = token.content;
        fragment.append(span);
      }
      if (index < lines.length - 1) {
        fragment.append("\n");
      }
    });
    code.replaceChildren(fragment);
  }
}

export function MarkdownPreview({
  text,
  path,
  target,
  side,
  onOpenFile,
}: {
  readonly text: string;
  readonly path: string;
  readonly target: FileRequestContext;
  readonly side: SnapshotSide;
  readonly onOpenFile: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooLarge = codeLineCount(text) > CODE_HIGHLIGHT_LINE_LIMIT;

  useEffect(() => {
    if (tooLarge || !text) {
      setHtml(null);
      setError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [{ marked }, { default: DOMPurify }] = await Promise.all([
          import("marked"),
          import("dompurify"),
        ]);
        const rendered = await marked.parse(text, { gfm: true });
        const clean = DOMPurify.sanitize(rendered, MARKDOWN_SANITIZE_OPTIONS);
        const template = document.createElement("template");
        template.innerHTML = clean;
        const root = template.content;
        assignHeadingIds(root);
        rewriteLinks(root, path);
        rewriteImages(root, path, target, side);
        await highlightCodeBlocks(root);
        if (cancelled) {
          return;
        }
        const host = document.createElement("div");
        host.append(root);
        setHtml(host.innerHTML);
        setError(null);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, side, target, text, tooLarge]);

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest("a");
    if (!anchor) {
      return;
    }
    const snapshotPath = anchor.dataset.snapshotPath;
    if (snapshotPath) {
      event.preventDefault();
      onOpenFile(snapshotPath);
      return;
    }
    const anchorId = anchor.dataset.anchorId;
    if (anchorId !== undefined) {
      event.preventDefault();
      const targetElement = Array.from(
        containerRef.current?.querySelectorAll("[id]") ?? [],
      ).find((element) => element.id === anchorId);
      targetElement?.scrollIntoView({ block: "start" });
      return;
    }
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      event.preventDefault();
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Keep the raw fragment when it is not valid percent-encoding.
      }
      const targetElement = Array.from(
        containerRef.current?.querySelectorAll("[id]") ?? [],
      ).find((element) => element.id === id);
      targetElement?.scrollIntoView({ block: "start" });
    }
  };

  if (tooLarge) {
    return (
      <div className="code-notice" data-testid="markdown-too-large">
        Too large to preview. Switch to Code to read it.
      </div>
    );
  }
  if (error) {
    return <div className="diff-empty">{error}</div>;
  }
  if (html === null) {
    return <div className="diff-empty">Loading preview…</div>;
  }
  return (
    <div
      ref={containerRef}
      className="markdown-preview"
      data-testid="markdown-preview"
      onClick={onClick}
      // Sanitised with DOMPurify above; event handlers and unsafe URLs are gone.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
