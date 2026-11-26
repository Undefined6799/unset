// The reader's warm-up (book P1.21k): a fresh process reads a text of its own before it serves, so the first member's
// card does not meet a parser V8 has yet to compile. What it is for is a fresh process, so that is what is measured:
// each case starts a Node of its own and prints what its first parse of a full card cost.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReadme } from "@unset/apps-web/lib/profile/parse.ts";
import { describe, expect, test } from "vitest";
import { warmParser } from "./text-reader.ts";

const READER = new URL("./text-reader.ts", import.meta.url).href;
const PARSER = import.meta.resolve("@unset/apps-web/lib/profile/parse.ts");

/**
 * The processor time, in ms, that a fresh process's first parse of the largest card as one table takes, after the
 * warm-up or without it. Processor time and not the clock, so a busy test machine does not count (text-reader.test.ts
 * `processorMs`).
 */
function firstParseMs(warmed: boolean): number {
  const code = `
    import { warmParser } from ${JSON.stringify(READER)};
    import { parseReadme } from ${JSON.stringify(PARSER)};
    const row = "| **one** | _two_ | \`three\` |\\n";
    const text = "| a | b | c |\\n| --- | --- | --- |\\n" + row.repeat(Math.floor(19_960 / row.length));
    if (${warmed}) warmParser();
    const before = process.threadCpuUsage();
    parseReadme(text);
    const used = process.threadCpuUsage(before);
    process.stdout.write(String((used.user + used.system) / 1_000));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });
  return Number(out);
}

describe("the reader's warm-up", () => {
  // Measured 2026-11-24 on Node 26.12: 133 to 148 ms without the warm-up, 61 to 95 ms after it. The quicker of two
  // fresh processes is taken each way, and the bar is a fifth off where a half is measured.
  test("a fresh process's first parse of a full card costs less after the warm-up", () => {
    const cold = Math.min(firstParseMs(false), firstParseMs(false));
    const warm = Math.min(firstParseMs(true), firstParseMs(true));
    const said = `after the warm-up ${Math.round(warm)} ms, without it ${Math.round(cold)} ms`;
    expect(warm, said).toBeLessThan(0.8 * cold);
  }, 30_000);

  // What costs in a card is what the warm-up must have read: each kind of block and of inline the page draws, but a
  // rule, which is a line of its own and costs nothing.
  test("the warm-up reads a text that holds every kind of block and inline but a rule", () => {
    const read: string[] = [];
    warmParser((text) => read.push(text));
    expect(new Set(read).size).toBe(1);
    const kinds = new Set<string>();
    const walk = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      if ("kind" in value && typeof value.kind === "string") kinds.add(value.kind);
      for (const inner of Object.values(value)) walk(inner);
    };
    walk(parseReadme(read[0] ?? ""));
    expect([...kinds].sort()).toEqual(
      ["break", "code", "del", "em", "heading", "link", "list", "paragraph", "quote", "strong", "table", "text"].sort(),
    );
  });
});
