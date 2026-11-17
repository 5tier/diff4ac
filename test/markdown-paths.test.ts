import { describe, expect, test } from "bun:test";
import {
  isMarkdownPath,
  markdownHeadingId,
  resolveMarkdownImage,
  resolveMarkdownLink,
  resolveMarkdownPath,
} from "../web/markdown-html";

describe("markdown paths", () => {
  test("recognises markdown files", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/Guide.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("docs/guide.txt")).toBe(false);
    expect(isMarkdownPath("markdown")).toBe(false);
  });

  test("resolves relative paths against the markdown file", () => {
    expect(resolveMarkdownPath("docs/guide.md", "other.md")).toBe(
      "docs/other.md",
    );
    expect(resolveMarkdownPath("docs/guide.md", "./img.png")).toBe(
      "docs/img.png",
    );
    expect(resolveMarkdownPath("docs/guide.md", "../logo.png")).toBe(
      "logo.png",
    );
    expect(resolveMarkdownPath("docs/guide.md", "/logo.png")).toBe(
      "logo.png",
    );
    expect(resolveMarkdownPath("docs/a/guide.md", "../b/x.md")).toBe(
      "docs/b/x.md",
    );
  });

  test("rejects paths that escape the repository", () => {
    expect(resolveMarkdownPath("docs/guide.md", "../../etc/passwd")).toBeNull();
    expect(resolveMarkdownPath("guide.md", "../x")).toBeNull();
    expect(resolveMarkdownPath("docs/guide.md", "..\\x")).toBeNull();
    expect(resolveMarkdownPath("docs/guide.md", "C:/x")).toBeNull();
    expect(resolveMarkdownPath("docs/guide.md", "/../x")).toBeNull();
  });

  test("classifies links", () => {
    expect(resolveMarkdownLink("docs/guide.md", "other.md")).toEqual({
      kind: "file",
      path: "docs/other.md",
      anchor: null,
    });
    expect(resolveMarkdownLink("docs/guide.md", "other.md#part")).toEqual({
      kind: "file",
      path: "docs/other.md",
      anchor: "part",
    });
    expect(resolveMarkdownLink("docs/guide.md", "#part")).toEqual({
      kind: "anchor",
      id: "part",
    });
    expect(resolveMarkdownLink("docs/guide.md", "https://example.com")).toEqual(
      { kind: "external", href: "https://example.com" },
    );
    expect(resolveMarkdownLink("docs/guide.md", "mailto:a@example.com")).toEqual(
      { kind: "external", href: "mailto:a@example.com" },
    );
    expect(resolveMarkdownLink("docs/guide.md", "javascript:alert(1)")).toEqual(
      { kind: "drop" },
    );
    expect(resolveMarkdownLink("docs/guide.md", "//cdn.example.com/x")).toEqual(
      { kind: "drop" },
    );
    expect(resolveMarkdownLink("docs/guide.md", "../../secret")).toEqual({
      kind: "drop",
    });
  });

  test("resolves only safe relative images", () => {
    expect(resolveMarkdownImage("docs/guide.md", "pixel.png")).toBe(
      "docs/pixel.png",
    );
    expect(resolveMarkdownImage("docs/guide.md", "../pixel.png")).toBe(
      "pixel.png",
    );
    expect(resolveMarkdownImage("docs/guide.md", "/pixel.png")).toBe(
      "pixel.png",
    );
    expect(resolveMarkdownImage("docs/guide.md", "https://example.com/x.png")).toBeNull();
    expect(resolveMarkdownImage("docs/guide.md", "//cdn/x.png")).toBeNull();
    expect(resolveMarkdownImage("docs/guide.md", "data:image/png;base64,x")).toBeNull();
    expect(resolveMarkdownImage("docs/guide.md", "../../x.png")).toBeNull();
  });

  test("turns headings into stable ids", () => {
    expect(markdownHeadingId("Hello, World!")).toBe("hello-world");
    expect(markdownHeadingId("  A   B  ")).toBe("a-b");
    expect(markdownHeadingId("!!!")).toBe("section");
  });
});
