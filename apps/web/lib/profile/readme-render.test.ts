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
  test("headings start under the page heading, as the card has none of its own", () => {
    expect(html("# A\n\n## B\n\n### C")).toBe("<h2>A</h2><h3>B</h3><h4>C</h4>");
  });

  test("struck words are a del, and a task's box is shown ticked or not and cannot be changed", () => {
    expect(html("~~gone~~ kept")).toBe("<p><del>gone</del> kept</p>");
    expect(html("- [x] done\n- [ ] open\n- plain")).toBe(
      '<ul><li><input type="checkbox" checked="" disabled=""/>done</li><li><input type="checkbox" disabled=""/>open</li><li>plain</li></ul>',
    );
  });

  test("a table has a header row and is aligned per column", () => {
    expect(html("| a | b |\n| :-: | --: |\n| 1 | **2** |")).toBe(
      "<div><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table></div>",
    );
    expect(html("| a |\n| --- |")).toBe("<div><table><thead><tr><th>a</th></tr></thead></table></div>");
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
