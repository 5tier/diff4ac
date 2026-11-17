import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { MARKDOWN_SANITIZE_OPTIONS } from "../web/markdown-html";
import { launchChromium } from "./helpers/browser";

const DOMPURIFY = join(
  import.meta.dir,
  "..",
  "node_modules",
  "dompurify",
  "dist",
  "purify.min.js",
);

let browser: Browser;
let page: Page;

afterEach(async () => {
  await page?.close().catch(() => {});
});

describe("markdown sanitising", () => {
  test("removes scripts, handlers, unsafe URLs, forms and styles", async () => {
    browser = await launchChromium();
    page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ path: DOMPURIFY });

    const clean = await page.evaluate((options) => {
      const purify = (globalThis as { DOMPurify?: { sanitize: Function } })
        .DOMPurify;
      if (!purify) {
        throw new Error("DOMPurify did not load");
      }
      return purify.sanitize(
        `<h1>Safe</h1>
        <script>window.pwned = 1</script>
        <iframe src="https://example.com/evil"></iframe>
        <form action="/x"><input name="x"></form>
        <img src="x" onerror="window.pwned = 2" style="color:red" alt="x">
        <a href="javascript:alert(1)">bad</a>
        <a href="https://example.com">good</a>
        <details><summary>More</summary>text</details>
        <kbd>Ctrl</kbd>
        <ul><li><input type="checkbox" disabled checked> done</li></ul>
        <div style="background:red">styled</div>`,
        options,
      ) as string;
    }, MARKDOWN_SANITIZE_OPTIONS);

    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<form");
    expect(clean).not.toContain("style=");
    expect(clean).toContain("<details");
    expect(clean).toContain("<kbd");
    expect(clean).toContain('type="checkbox"');
    expect(clean).toContain('href="https://example.com"');
  }, 30_000);
});
