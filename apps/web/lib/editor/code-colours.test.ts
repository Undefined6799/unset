// The code colours the page and the editor share (P1.21v): the page's runs come from the same language parsers the
// editor loads, each run's class is one of CODE_COLOURS, and each colour is a theme variable with a page rule.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CODE_COLOURS, colourCode } from "./code-colours.ts";

const repo = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8");

describe("colourCode", () => {
  test("a known language gives runs that join back to the text, keeping line ends", async () => {
    const text = 'const a = "<b>x</b>";\n// note\nf(1)';
    const runs = await colourCode(text, "js");
    expect(runs?.map((run) => run.text).join("")).toBe(text);
    expect(runs).toContainEqual({ text: "const", colour: "code-keyword" });
    expect(runs).toContainEqual({ text: '"<b>x</b>"', colour: "code-string" });
    expect(runs).toContainEqual({ text: "// note", colour: "code-comment" });
    expect(runs).toContainEqual({ text: "1", colour: "code-number" });
    expect(runs).toContainEqual({ text: "f", colour: "code-function" });
  });

  test("the language is found by name or alias, in any case", async () => {
    expect(await colourCode("def f(): pass", "Python")).toContainEqual({ text: "def", colour: "code-keyword" });
    expect(await colourCode("let a: number", "TS")).toContainEqual({ text: "let", colour: "code-keyword" });
  });

  test("markup is coloured as markup and stays text", async () => {
    const runs = await colourCode('<a href="javascript:x" onclick="y">z</a>', "html");
    expect(runs?.map((run) => run.text).join("")).toBe('<a href="javascript:x" onclick="y">z</a>');
    expect(runs).toContainEqual({ text: "a", colour: "code-tag" });
    expect(runs).toContainEqual({ text: "onclick", colour: "code-attribute" });
  });

  test("no language, or one CodeMirror does not know, is plain text", async () => {
    expect(await colourCode("x", "")).toBeNull();
    expect(await colourCode("x", '"><img')).toBeNull();
    expect(await colourCode("x", "../../etc/passwd")).toBeNull();
  });
});

describe("the shared colours", () => {
  test("each colour is a theme variable, light and dark", () => {
    const theme = read("shared/ui/theme.css");
    for (const { name } of CODE_COLOURS)
      expect(theme).toMatch(new RegExp(`--code-${name}: light-dark\\(#[0-9a-f]{6}, #[0-9a-f]{6}\\);`));
  });

  test("the page draws each colour's class with its variable", () => {
    const css = read("apps/web/app.css").replace(/\s+/g, " ");
    for (const { name } of CODE_COLOURS) expect(css).toContain(`.code-${name} { color: var(--code-${name});`);
  });
});
