// CODE_COLOUR_LIMITS holds every language to a short parse (P1.21v; review of #2004 at e36de8a, where one Textile
// line of "<a " took 182 s inside the page load). For each of CodeMirror's languages, the input shapes that gave the
// longest parser steps in the measurement (apps/web/lib/editor/code-colours.ts) are coloured at the limits' full size:
// each block must come back within its budget plus one parser step, coloured or plain. A new language or a parser
// upgrade with a slower step fails here. The edges of each limit are tested too.
import {
  CODE_LANGUAGES,
  type Colouring,
  codeColourBudget,
  colourCode,
} from "@unset/apps-web/lib/editor/code-colours.ts";
import { describe, expect, test } from "vitest";
import { CODE_COLOUR_LIMITS as LIMITS } from "./limits.ts";

/** The longest step measured was about 35 ms (70 ms with the block's own 30); room for a slow, busy test machine. */
const ONE_STEP_MS = 250;

/** `piece` repeated in lines of at most `width` characters, `chars` in all. */
const lines = (piece: string, chars: number, width: number) =>
  (piece.repeat(Math.ceil(chars / piece.length)).match(new RegExp(`[^]{1,${width - 1}}`, "g")) ?? [])
    .join("\n")
    .slice(0, chars);
const full = (piece: string) => lines(piece, LIMITS.chars, LIMITS.lineChars);
const SHAPES = ["<a ", "/*", "(", "[", "*_", "<a b='"].map(full);

const timed = async (text: string, language: string, limits = LIMITS): Promise<{ ms: number; coloured: Colouring }> => {
  const started = performance.now();
  const coloured = await colourCode(text, language, codeColourBudget(limits));
  return { ms: performance.now() - started, coloured };
};
/** The size limits alone: the edge tests must not depend on how busy the machine is. */
const UNTIMED = { ...LIMITS, blockMs: 60_000, pageMs: 60_000 };

describe("CODE_COLOUR_LIMITS", () => {
  test("every language's hostile block ends within the block budget and one step", { timeout: 240_000 }, async () => {
    const slow: string[] = [];
    for (const language of CODE_LANGUAGES) {
      await colourCode("x", language, codeColourBudget(LIMITS)); // the module loads once, outside the clock
      for (const [i, text] of SHAPES.entries()) {
        const { ms } = await timed(text, language);
        if (ms > LIMITS.blockMs + ONE_STEP_MS) slow.push(`${language} shape ${i}: ${Math.round(ms)} ms`);
      }
    }
    expect(slow).toEqual([]);
  });

  test("a block of `chars` characters is coloured, one more is plain", async () => {
    const block = lines("let a = 1; ", LIMITS.chars, 80);
    expect(block).toHaveLength(LIMITS.chars);
    expect((await timed(block, "js", UNTIMED)).coloured).toHaveProperty("runs");
    expect((await timed(`${block}a`, "js", UNTIMED)).coloured).toEqual({ plain: "size" });
  });

  test("a line of `lineChars` characters is coloured, one more is plain", async () => {
    const line = `let a = "${"x".repeat(LIMITS.lineChars - 11)}";`;
    expect(line).toHaveLength(LIMITS.lineChars);
    expect((await timed(line, "js", UNTIMED)).coloured).toHaveProperty("runs");
    expect((await timed(`${line} `, "js", UNTIMED)).coloured).toEqual({ plain: "size" });
  });

  // Normal use fits inside the limit (Alex 2026-11-19): the quickest of five parses, so a busy moment does not count.
  test("a normal full-size block parses within `blockMs`", async () => {
    const block = lines("export function f(a: number): string {\n  return `${a}`; // n\n}\n", LIMITS.chars, 80);
    const runs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { ms, coloured } = await timed(block, "ts", UNTIMED);
      expect(coloured).toHaveProperty("runs");
      runs.push(ms);
    }
    expect(Math.min(...runs)).toBeLessThan(LIMITS.blockMs);
  });

  test("the page stops colouring once `pageMs` is spent", async () => {
    const budget = codeColourBudget(LIMITS);
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) await colourCode(full("<a "), "textile", budget);
    expect(performance.now() - started).toBeLessThan(LIMITS.pageMs + ONE_STEP_MS);
    expect(await colourCode("let a;", "js", budget)).toEqual({ plain: "time" });
  });
});
