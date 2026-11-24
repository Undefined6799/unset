// The code colours the page and the editor share (P1.21v): the page's runs come from the same language parsers the
// editor loads, each run's class is one of CODE_COLOURS, and each colour is a theme variable with a page rule.
// Colouring runs on the server inside the page load, on a member's text, so it is bounded: a block past the limits, a
// parse that runs out of time and a parser that throws all leave the code plain (review of #2004 at e36de8a). The
// real numbers and the sweep over every language are in interfaces/web/src/lib/server/limits.code.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CODE_COLOURS, type CodeColourLimits, codeColourBudget, colourable, colourCode } from "./code-colours.ts";

const repo = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8");

const LIMITS: CodeColourLimits = { chars: 2_000, lineChars: 100, blockMs: 50, pageMs: 100 };
const colour = (text: string, language: string, limits = LIMITS) =>
  colourCode(text, language, codeColourBudget(limits));
/** The runs, or null when the block stays plain. */
const runsOf = async (text: string, language: string) => {
  const coloured = await colour(text, language);
  return "runs" in coloured ? coloured.runs : null;
};
/** `piece` repeated in lines of at most `width` characters, `chars` in all. */
const lines = (piece: string, chars: number, width: number) =>
  (piece.repeat(Math.ceil(chars / piece.length)).match(new RegExp(`[^]{1,${width - 1}}`, "g")) ?? [])
    .join("\n")
    .slice(0, chars);

describe("colourCode", () => {
  test("a known language gives runs that join back to the text, keeping line ends", async () => {
    const text = 'const a = "<b>x</b>";\n// note\nf(1)';
    const runs = await runsOf(text, "js");
    expect(runs?.map((run) => run.text).join("")).toBe(text);
    expect(runs).toContainEqual({ text: "const", colour: "code-keyword" });
    expect(runs).toContainEqual({ text: '"<b>x</b>"', colour: "code-string" });
    expect(runs).toContainEqual({ text: "// note", colour: "code-comment" });
    expect(runs).toContainEqual({ text: "1", colour: "code-number" });
    expect(runs).toContainEqual({ text: "f", colour: "code-function" });
  });

  test("uncoloured neighbours are one run, line ends included, so the page's data stays small", async () => {
    const runs = (await runsOf("a\n\n  b", "js")) ?? [];
    expect(runs).toEqual([{ text: "a\n\n  b", colour: "" }]);
  });

  test("the language is found by name or alias, in any case", async () => {
    expect(await runsOf("def f(): pass", "Python")).toContainEqual({ text: "def", colour: "code-keyword" });
    expect(await runsOf("let a: number", "TS")).toContainEqual({ text: "let", colour: "code-keyword" });
  });

  test("markup is coloured as markup and stays text", async () => {
    const runs = await runsOf('<a href="javascript:x" onclick="y">z</a>', "html");
    expect(runs?.map((run) => run.text).join("")).toBe('<a href="javascript:x" onclick="y">z</a>');
    expect(runs).toContainEqual({ text: "<a", colour: "code-tag" });
    expect(runs).toContainEqual({ text: "onclick", colour: "code-attribute" });
  });

  test("no language, or one CodeMirror does not know, is plain text", async () => {
    expect(await colour("x", "")).toEqual({ plain: "language" });
    expect(await colour("x", '"><img')).toEqual({ plain: "language" });
    expect(await colour("x", "../../etc/passwd")).toEqual({ plain: "language" });
  });

  // Markdown's parser takes a whole paragraph in one step, which no line limit bounds.
  test("markdown stays plain", async () => {
    expect(await colour("# Hi *there*", "markdown")).toEqual({ plain: "language" });
    expect(await colour("# Hi *there*", "md")).toEqual({ plain: "language" });
  });
});

describe("colourCode's limits", () => {
  test("a block of `chars` characters is coloured, one more is plain", async () => {
    const block = lines("let a = 1; ", LIMITS.chars, 50);
    expect(block).toHaveLength(LIMITS.chars);
    expect(await colour(block, "js")).toHaveProperty("runs");
    expect(await colour(`${block}a`, "js")).toEqual({ plain: "size" });
  });

  test("a line of `lineChars` characters is coloured, one more is plain", async () => {
    const line = "a".repeat(LIMITS.lineChars);
    expect(await colour(`let x;\n${line}`, "js")).toHaveProperty("runs");
    expect(await colour(`let x;\n${line}a`, "js")).toEqual({ plain: "size" });
  });

  // The reviewer's input: one Textile line of "<a " took 182 s at 20,000 bytes (stream parsers take a line per step).
  test("a long hostile line is plain at once", async () => {
    const started = performance.now();
    expect(await colour("<a ".repeat(600), "textile")).toEqual({ plain: "size" });
    expect(performance.now() - started).toBeLessThan(LIMITS.blockMs);
  });

  test("a parse that runs out of time is plain", async () => {
    const slow = lines("<a ", LIMITS.chars, LIMITS.lineChars);
    expect(await colour(slow, "textile", { ...LIMITS, blockMs: 0 })).toEqual({ plain: "time" });
    expect(await colour("let a;", "js", { ...LIMITS, blockMs: 0 })).toEqual({ plain: "time" });
  });

  // Scala, Kotlin and Dart's nested comment recurses once per "/*" and overflows the stack (legacy-modes clike.js).
  test("a parser that throws leaves the code plain", async () => {
    const deep = "/*".repeat(20_000);
    const roomy = { ...LIMITS, chars: deep.length, lineChars: deep.length, blockMs: 10_000, pageMs: 10_000 };
    for (const language of ["scala", "kotlin", "dart"])
      await expect(colour(deep, language, roomy)).resolves.toEqual({ plain: "error" });
  });

  test("one page's blocks share `pageMs`: once it is spent the rest are plain", async () => {
    const budget = codeColourBudget({ chars: 20_000, lineChars: 1_000, blockMs: 5, pageMs: 5 });
    const slow = lines("<a ", 20_000, 1_000);
    const started = performance.now();
    for (let i = 0; i < 10; i += 1) expect(await colourCode(slow, "textile", budget)).toEqual({ plain: "time" });
    expect(budget.spentMs).toBeGreaterThanOrEqual(5);
    expect(await colourCode("let a;", "js", budget)).toEqual({ plain: "time" });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

// The editor's CodeMirror asks the same question before it loads a language, and again on every change, so it never
// colours what the page would not (code-block.ts).
describe("colourable", () => {
  test("a language within the limits may be coloured", () => {
    expect(colourable("JavaScript", "let a;\nlet b;", LIMITS)).toBe(true);
  });
  test("a line or a block past the limits may not", () => {
    expect(colourable("JavaScript", `let a = "${"x".repeat(100)}";`, LIMITS)).toBe(false);
    expect(colourable("JavaScript", "let a;\n".repeat(400), LIMITS)).toBe(false);
  });
  test("Markdown never is: its parser takes a whole paragraph in one step", () => {
    expect(colourable("Markdown", "*a*", LIMITS)).toBe(false);
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
