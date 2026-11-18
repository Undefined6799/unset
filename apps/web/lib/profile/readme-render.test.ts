// The README card's markup (ADR 0051), moved from the React card's test with P1.20k: readme.svelte, compiled for the
// server by the pinned Svelte (svelte 5.57.3 `compile` with `generate: "server"`, then `render` from svelte/server),
// renders what parse.ts made of member text. Raw HTML stays text, a link that is not http or https is never an <a>,
// and every link opens as user content.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import type { Component } from "svelte";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseReadme } from "./parse.ts";
import type { Block } from "./types.ts";

type Readme = Component<{ blocks: readonly Block[] }>;
let Readme: Readme;
// The compiled module imports svelte/internal/server, so it is written beside this file, where that resolves.
const dir = mkdtempSync(join(import.meta.dirname, ".readme-render-"));
beforeAll(async () => {
  const source = readFileSync(join(import.meta.dirname, "..", "components", "profile", "readme.svelte"), "utf8");
  const { js } = compile(source, { generate: "server", filename: "readme.svelte" });
  const file = join(dir, "readme.js");
  writeFileSync(file, js.code);
  Readme = (await import(pathToFileURL(file).href)).default as Readme;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The card's markup without Svelte's hydration comments and the presentation classes. */
function html(src: string): string {
  const blocks: readonly Block[] = parseReadme(src);
  const { body } = render(Readme, { props: { blocks } });
  return body
    .replace(/<!--[^>]*-->/g, "")
    .replace(/ class="[^"]*"/g, "")
    .replace(/^<div>|<\/div>$/g, "");
}

describe("Readme", () => {
  test("headings sit under the card's own heading", () => {
    expect(html("# A\n\n## B\n\n### C")).toBe("<h3>A</h3><h4>B</h4><h5>C</h5>");
  });

  test("an ordered list keeps its first number", () => {
    expect(html("3. third\n4. fourth")).toContain('<ol start="3">');
  });

  test.each([
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,hi)",
    "[x](vbscript:x)",
    "[x](//evil.example)",
    "[x](/relative)",
    "[x](https://user:pw@evil.example)",
    "[x](mailto:a@b.example)",
    "<javascript:alert(1)>",
  ])("a link that is not plain http or https stays text: %s", (src) => {
    expect(html(src)).not.toContain("<a");
  });

  test("raw HTML is shown as text", () => {
    expect(html('<script>alert(1)</script><img src=x onerror="alert(1)">')).toBe(
      '<p>&lt;script>alert(1)&lt;/script>&lt;img src=x onerror="alert(1)"></p>',
    );
  });

  test("links open as user content", () => {
    expect(html("[a](https://a.example)")).toBe(
      '<p><a href="https://a.example/" rel="nofollow ugc noopener noreferrer">a</a></p>',
    );
  });

  test("random input never yields script, handlers or unsafe links", () => {
    const pieces = fc.constantFrom(
      "<",
      ">",
      '"',
      "'",
      "&",
      "javascript:",
      "data:",
      "\u0000",
      "[",
      "](",
      ")",
      "*",
      "**",
      "`",
      "```\n",
      "\n",
      "# ",
      "> ",
      "- ",
      "https://a.example",
      "<script>",
      " onerror=",
      "x",
      " ",
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 60 }), (parts) => {
        const out = html(parts.join(""));
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toMatch(/<[a-z]+[^>]*\son[a-z]+=/i);
        for (const [, href] of out.matchAll(/<a href="([^"]*)"/g)) expect(href).toMatch(/^https?:\/\//);
      }),
      { numRuns: 10_000, seed: 51 },
    );
  });
});
