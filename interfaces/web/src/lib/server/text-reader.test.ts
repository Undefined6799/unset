// The page's Markdown reader (book P1.21k): a parse that would hold the process is stopped at its limit and the card
// is shown as plain text. The times asserted are loose on purpose: the unbounded parses take seconds, the limits are
// tens of milliseconds, and each bar sits far from both, so a slow machine does not decide a test.
import { type Block, parseReadme, plainText } from "@unset/apps-web/lib/profile/parse.ts";
import { describe, expect, test } from "vitest";
import { TEXT_READ_LIMITS } from "./limits.ts";
import { pageTextReader, type TextReadLimits, within } from "./text-reader.ts";

/** Far past any test's limit, so the request's own deadline decides nothing. */
const LATER = Number.POSITIVE_INFINITY;
const CEILING = 20_000;
const repeated = (shape: string) => shape.repeat(Math.ceil(CEILING / shape.length)).slice(0, CEILING);
const forever = (): never => {
  for (;;) {
    // Never ends by itself.
  }
};
function timed<T>(run: () => T): { out: T; ms: number } {
  const started = performance.now();
  const out = run();
  return { out, ms: performance.now() - started };
}

describe("within", () => {
  test("a task that ends in time gives its result", () => {
    expect(within(1_000, () => 6 * 7)).toEqual({ value: 42 });
  });

  test("a task that never ends is stopped at the limit", () => {
    const { out, ms } = timed(() => within(20, forever));
    expect(out).toEqual({ stopped: true });
    expect(ms).toBeLessThan(1_000);
  });

  // The stop must reach code that is not a plain loop: a pattern that backtracks for longer than the universe lasts.
  test("a pattern match that never ends is stopped at the limit", () => {
    const { out, ms } = timed(() => within(20, () => /^(a+)+$/.test(`${"a".repeat(60)}!`)));
    expect(out).toEqual({ stopped: true });
    expect(ms).toBeLessThan(1_000);
  });

  test("an error the task throws is thrown on, not taken for a stop", () => {
    expect(() =>
      within(1_000, () => {
        throw new TypeError("the task's own");
      }),
    ).toThrow(TypeError);
  });

  test("after a stop the next task runs as usual", () => {
    expect(within(5, forever)).toEqual({ stopped: true });
    expect(within(1_000, () => "next")).toEqual({ value: "next" });
  });
});

describe("pageTextReader", () => {
  const GENEROUS: TextReadLimits = { textMs: 10_000, pageMs: 10_000 };

  test("a normal text is read as the parser reads it", () => {
    const text = "# Title\n\nSome **bold** words and a [link](https://a.example).\n\n- one\n- two";
    expect(pageTextReader(GENEROUS, LATER)(text)).toEqual(parseReadme(text));
  });

  // What micromark 4.0.3 takes seconds over at the text block's 20,000 characters, or overflows its stack on
  // (measured on Node 26.12: "_*" 5 s, "*_" 3.5 s, "*a" 2.3 s, "+ " 10 s, "1. " 5 s; ">" and "> " nest until the stack
  // ends). Under the page's real limits each is stopped and shown as it was written.
  test.each(["_*", "*_", "*a", "a*", "**a", "+ ", "1. ", ">", "> "])(
    "text written to stall the parser, %j repeated, is stopped and shown as plain text",
    (shape) => {
      const text = repeated(shape);
      const { out, ms } = timed(() => pageTextReader(TEXT_READ_LIMITS, LATER)(text));
      expect(out).toEqual(plainText(text));
      expect(ms).toBeLessThan(TEXT_READ_LIMITS.textMs + 1_000);
    },
  );

  test("one text gets at most its own limit, and the page's cards share the page's", () => {
    let started = 0;
    const read = pageTextReader({ textMs: 40, pageMs: 100 }, LATER, () => {
      started += 1;
      return forever();
    });
    const one = timed(() => read("first"));
    expect(one.out).toEqual(plainText("first"));
    expect(one.ms).toBeLessThan(40 + 1_000);
    const rest = timed(() => Array.from({ length: 50 }, (_, i) => read(`card ${i}`)));
    expect(rest.out[49]).toEqual(plainText("card 49"));
    // 100 ms of page limit holds at most two full 40 ms reads and a shorter third; no read starts after it is spent.
    expect(started).toBeLessThanOrEqual(4);
    expect(rest.ms).toBeLessThan(100 + 1_000);
  });

  test("time a read used is taken from the page's limit even when it ended in time", () => {
    let calls = 0;
    const slow = (text: string): Block[] => {
      calls += 1;
      const until = performance.now() + 30;
      while (performance.now() < until) {
        // Works for 30 ms, then ends.
      }
      return parseReadme(text);
    };
    const read = pageTextReader({ textMs: 1_000, pageMs: 50 }, LATER, slow);
    expect(read("**a**")).toEqual(parseReadme("**a**"));
    for (let i = 0; i < 10; i += 1) read("**b**");
    expect(calls).toBeLessThanOrEqual(3);
    expect(read("**c**")).toEqual(plainText("**c**"));
  });

  test("no read starts once the request's deadline has passed", () => {
    let started = 0;
    const read = pageTextReader(GENEROUS, performance.now() - 1, (text) => {
      started += 1;
      return parseReadme(text);
    });
    expect(read("**late**")).toEqual(plainText("**late**"));
    expect(started).toBe(0);
  });

  test("a read is cut at the request's deadline when that comes before the limits", () => {
    const read = pageTextReader(GENEROUS, performance.now() + 30, forever);
    const { out, ms } = timed(() => read("text"));
    expect(out).toEqual(plainText("text"));
    expect(ms).toBeLessThan(30 + 1_000);
  });
});

describe("the page's limits", () => {
  // Normal use fits inside the limit (Alex 2026-11-19): the largest card the lexicon allows, as prose and as the
  // densest ordinary formatting, parses well within one text's limit (about 15, 35 and 55 ms). The quickest of five
  // parses is taken, with no deadline running, so a busy moment on the test machine does not count.
  const prose = "The quick brown fox jumps over the lazy dog, and then it rests for a while.\n\n";
  const formatted = "- **term** and *more* with [a link](https://a.example/x) and `code`\n";
  const row = "| **one** | _two_ | `three` |\n";
  test.each([
    ["prose", repeated(prose)],
    ["a list with every kind of inline formatting", repeated(formatted)],
    ["one table", `| a | b | c |\n| --- | --- | --- |\n${row.repeat(Math.floor((CEILING - 40) / row.length))}`],
  ])("a full card of %s parses within one text's limit", (_name, text) => {
    expect(text.length).toBeLessThanOrEqual(CEILING);
    expect(text.length).toBeGreaterThan(CEILING - 100);
    const runs = Array.from({ length: 5 }, () => timed(() => parseReadme(text)));
    expect(runs[0]?.out).not.toEqual(plainText(text));
    expect(Math.min(...runs.map((run) => run.ms))).toBeLessThan(TEXT_READ_LIMITS.textMs);
  });

  test("the page's limit holds two full reads, and no page load reads for more than 300 ms", () => {
    expect(TEXT_READ_LIMITS.pageMs).toBeGreaterThanOrEqual(2 * TEXT_READ_LIMITS.textMs);
    expect(TEXT_READ_LIMITS.pageMs).toBeLessThanOrEqual(300);
  });
});
