// The README card's markup (ADR 0051), moved from the React card's test with P1.20k: readme.svelte, compiled for the
// server by the pinned Svelte (svelte 5.57.3 `compile` with `generate: "server"`, then `render` from svelte/server),
// renders what parse.ts made of member text. Raw HTML stays text, a link that is not http or https is never an <a>,
// and every link opens as user content.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { parseFragment } from "parse5";
import type { Component } from "svelte";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseReadme, plainText } from "./parse.ts";
import type { Block, TableLines } from "./types.ts";

type Readme = Component<{ blocks: readonly Block[]; lines?: TableLines }>;
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

  // Six levels, as the playground's block menu offers (Alex 2026-11-21 18:52:12Z); HTML stops at h6, so the last two
  // share it and keep their own sizes.
  test("all six heading levels are shown, the fifth and sixth both as an h6", () => {
    expect(html("#### D\n\n##### E\n\n###### F")).toBe("<h5>D</h5><h6>E</h6><h6>F</h6>");
  });

  test("struck words are a del, and a task's box is shown ticked or not and cannot be changed", () => {
    expect(html("~~gone~~ kept")).toBe("<p><del>gone</del> kept</p>");
    expect(html("- [x] done\n- [ ] open\n- plain")).toBe(
      '<ul><li><input type="checkbox" checked="" aria-label="done" disabled=""/>done</li><li><input type="checkbox" aria-label="open" disabled=""/>open</li><li>plain</li></ul>',
    );
    // A task with no words gets no empty name: an empty aria-label names nothing.
    // A task whose words are only spaces gets no empty name (review of #2006): an empty aria-label names nothing.
    expect(html("- [ ] ``   ``")).toBe('<ul><li><input type="checkbox" disabled=""/><code>   </code></li></ul>');
  });

  test("a table has a header row and is aligned per column", () => {
    expect(html("| a | b |\n| :-: | --: |\n| 1 | **2** |")).toBe(
      "<div><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table></div>",
    );
    expect(html("| a |\n| --- |")).toBe("<div><table><thead><tr><th>a</th></tr></thead></table></div>");
  });

  // ADR 0110 point 2: the card's four switches draw every table in it. Our look with none on: a line under the header
  // and between rows, no column lines, no outline.
  test("a table's lines follow the card's switches", () => {
    const NONE = { hideHeaderLine: false, hideRowLines: false, showColumnLines: false, showOutline: false };
    const tag = (src: string, lines: TableLines | undefined, name: string): string[] => {
      const { body } = render(Readme, {
        props: { blocks: parseReadme(src), ...(lines === undefined ? {} : { lines }) },
      });
      return [...body.matchAll(new RegExp(`<${name} class="([^"]*)"`, "g"))].map((match) => match[1] ?? "");
    };
    const lined = (classes: string[], line: string) => classes.map((names) => names.split(" ").includes(line));
    const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |";

    expect(lined(tag(TABLE, undefined, "th"), "border-b")).toEqual([true, true]);
    expect(lined(tag(TABLE, undefined, "td"), "border-b")).toEqual([true, true]);
    expect(lined(tag(TABLE, undefined, "td"), "border-s")).toEqual([false, false]);
    expect(lined(tag(TABLE, undefined, "table"), "border")).toEqual([false]);

    const all = { hideHeaderLine: true, hideRowLines: true, showColumnLines: true, showOutline: true };
    expect(lined(tag(TABLE, all, "th"), "border-b")).toEqual([false, false]);
    // The outline is drawn on the outer cells (ADR 0110 point 5: an edge can hide part of it), so the bottom row's
    // cells draw it under them and the table draws none of its own.
    expect(lined(tag(TABLE, all, "th"), "border-t")).toEqual([true, true]);
    expect(lined(tag(TABLE, all, "td"), "border-b")).toEqual([true, true]);
    expect(lined(tag(TABLE, all, "th"), "border-s")).toEqual([true, true]);
    expect(lined(tag(TABLE, all, "td"), "border-e")).toEqual([true, true]);
    expect(lined(tag(TABLE, all, "table"), "border")).toEqual([false]);
    // Without the outline a column line stands between columns only.
    const columns = { ...NONE, showColumnLines: true };
    expect(lined(tag(TABLE, columns, "td"), "border-s")).toEqual([false, true]);
    expect(lined(tag(TABLE, columns, "td"), "border-e")).toEqual([true, false]);
    expect(lined(tag(TABLE, NONE, "td"), "border-b")).toEqual([true, true]);
  });

  // ADR 0110 points 4-5: a look placed on a table (view.ts) shows or hides single cell sides whatever the switches say.
  test("a table's edges show and hide single cell sides on both cells beside them", () => {
    const [table] = parseReadme("| a | b |\n| - | - |\n| 1 | 2 |");
    if (table?.kind !== "table") throw new Error("a table");
    const edges = [
      { direction: "horizontal", line: 1, cell: 1, hide: true },
      { direction: "vertical", line: 1, cell: 1, hide: false },
    ] as const;
    const { body } = render(Readme, { props: { blocks: [{ ...table, edges }] } });
    const classes = (name: string) =>
      [...body.matchAll(new RegExp(`<${name} class="([^"]*)"`, "g"))].map((match) => (match[1] ?? "").split(" "));
    expect(classes("th").map((names) => names.includes("border-b"))).toEqual([true, false]);
    expect(classes("td").map((names) => names.includes("border-t"))).toEqual([true, false]);
    expect(classes("td").map((names) => [names.includes("border-e"), names.includes("border-s")])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(classes("th").map((names) => names.includes("border-e"))).toEqual([false, false]);
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

  // Code is shown as text and never run or fetched (Alex 2026-11-23; lexicon sh.unset.block.text): whatever the code
  // holds, and however its block is opened or closed, the card's markup has no element of the member's making.
  const HOSTILE = [
    "<script>alert(1)</script>",
    '<img src="https://evil.example/x.png" onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    "[x](javascript:alert(1))",
    "</code></pre><script>alert(1)</script>",
  ];
  // "div" is the code block's own wrapper, the corner a Copy button sits in once script runs (P1.21v, #2012).
  const CARD_ELEMENTS = new Set(["div", "pre", "code", "p", "br", "blockquote", "ul", "li"]);
  type Node = { nodeName: string; value?: string; attrs?: unknown[]; childNodes?: Node[] };
  /** The markup's elements and its text, as an HTML parser reads it (parse5, the WHATWG algorithm). */
  function read(markup: string): { elements: { name: string; attributes: number }[]; text: string } {
    const elements: { name: string; attributes: number }[] = [];
    let text = "";
    const walk = (node: Node) => {
      if (node.nodeName === "#text") text += node.value ?? "";
      else if (!node.nodeName.startsWith("#"))
        elements.push({ name: node.nodeName, attributes: node.attrs?.length ?? 0 });
      node.childNodes?.forEach(walk);
    };
    walk(parseFragment(markup) as Node);
    return { elements, text };
  }
  const fenced = (code: string) => `\`\`\`\n${code}\n\`\`\``;
  test.each([
    ["a fenced block", fenced],
    ["an indented block", (code: string) => `    ${code}`],
    ["a code span", (code: string) => `\`\`${code}\`\``],
    ["a fenced block left open", (code: string) => `\`\`\`\n${code}`],
    ["a fenced block closed early", (code: string) => `\`\`\`\`\n${code}\n\`\`\`\n${code}\n\`\`\`\``],
    [
      "a fenced block with a hostile language name",
      (code: string) => `\`\`\`${code.replaceAll("`", "")}\n${code}\n\`\`\``,
    ],
    ["a fenced block in a quote", (code: string) => `> \`\`\`\n> ${code}\n> \`\`\``],
    ["a fenced block in a list item", (code: string) => `- \`\`\`\n  ${code}\n  \`\`\``],
  ])("markup inside %s is text", (_name, wrap) => {
    for (const code of HOSTILE) {
      // Read back as a browser reads it: only the card's own elements, none with an attribute, and the code as text.
      const { elements, text } = read(html(wrap(code)));
      expect(
        elements.filter(({ name }) => !CARD_ELEMENTS.has(name)),
        code,
      ).toEqual([]);
      expect(
        elements.filter(({ attributes }) => attributes > 0),
        code,
      ).toEqual([]);
      expect(text, code).toContain(code);
    }
  });

  test("a fence's language is never drawn, whatever it holds", () => {
    const drawn = "<div><pre><code>x</code></pre></div>";
    expect(html('```"><script>alert(1)</script>\nx\n```').replaceAll(" ", "")).toBe(drawn);
    expect(html("~~~ <img src=x onerror=alert(1)>\nx\n~~~").replaceAll(" ", "")).toBe(drawn);
  });

  // Raw HTML outside code is text too, as a block and inside a line (CommonMark's HTML blocks and inline HTML).
  test("an HTML block and inline HTML are shown as text", () => {
    expect(html('<div onclick="alert(1)">\n<script>alert(1)</script>\n</div>')).toBe(
      '<p>&lt;div onclick="alert(1)">\n&lt;script>alert(1)&lt;/script>\n&lt;/div></p>',
    );
    expect(html('a <img src=x onerror="alert(1)"> b')).toBe('<p>a &lt;img src=x onerror="alert(1)"> b</p>');
    expect(html("<!-- c --><?php x ?><![CDATA[y]]>")).not.toMatch(/<(?!\/?p>)/);
  });

  test("a card shown as plain text is escaped the same way", () => {
    const { body } = render(Readme, {
      props: { blocks: plainText("<script>alert(1)</script>\n[x](javascript:alert(1))") },
    });
    expect(body).not.toMatch(/<script|<a\b/i);
    expect(body).toContain("&lt;script>alert(1)&lt;/script>");
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
      "    ",
      "<!--",
      "<div>",
      "| a |\n| - |\n",
      "[a]: javascript:x\n",
      "[a]",
      "![",
      "www.a.example",
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
