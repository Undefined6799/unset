// The page's Markdown reader (book P1.21k): a parse that would hold the process is stopped at its limit and the card
// is shown as plain text, and what a read gave is remembered, so a text costs its time once and not on every page
// load. The times asserted are loose on purpose: the unbounded parses take seconds, the limits are tens of
// milliseconds, and each bar sits far from both, so a slow machine does not decide a test.
import { type Block, parseReadme, plainText } from "@unset/apps-web/lib/profile/parse.ts";
import { describe, expect, test } from "vitest";
import { TEXT_READ_LIMITS } from "./limits.ts";
import { createTextReads, readCard, type TextReadLimits, within } from "./text-reader.ts";

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

/** Room to remember every text a test reads, for ten minutes. */
const KEPT = { keptBytes: 50_000_000, keptForMs: 600_000 } as const;
const GENEROUS: TextReadLimits = { textMs: 10_000, pageMs: 10_000, ...KEPT };

describe("one page's reader", () => {
  test("a normal text is read as the parser reads it", () => {
    const text = "# Title\n\nSome **bold** words and a [link](https://a.example).\n\n- one\n- two";
    expect(createTextReads(GENEROUS).forPage(LATER)(text)).toEqual(parseReadme(text));
  });

  // What micromark 4.0.3 takes seconds over at the text block's 20,000 characters, or overflows its stack on
  // (measured on Node 26.12: "_*" 5 s, "*_" 3.5 s, "*a" 2.3 s, "+ " 10 s, "1. " 5 s; ">" and "> " nest until the stack
  // ends). Under the page's real limits each is stopped and shown as it was written.
  test.each(["_*", "*_", "*a", "a*", "**a", "+ ", "1. ", ">", "> "])(
    "text written to stall the parser, %j repeated, is stopped and shown as plain text",
    (shape) => {
      const text = repeated(shape);
      const { out, ms } = timed(() => createTextReads(TEXT_READ_LIMITS).forPage(LATER)(text));
      expect(out).toEqual(plainText(text));
      expect(ms).toBeLessThan(TEXT_READ_LIMITS.textMs + 1_000);
    },
  );

  test("one text gets at most its own limit, and the page's cards share the page's", () => {
    let started = 0;
    const read = createTextReads({ textMs: 40, pageMs: 100, ...KEPT }, () => {
      started += 1;
      return forever();
    }).forPage(LATER);
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
    const read = createTextReads({ textMs: 1_000, pageMs: 50, ...KEPT }, slow).forPage(LATER);
    expect(read("**a**")).toEqual(parseReadme("**a**"));
    for (let i = 0; i < 10; i += 1) read(`**b${i}**`);
    expect(calls).toBeLessThanOrEqual(3);
    expect(read("**c**")).toEqual(plainText("**c**"));
  });

  test("no read starts once the request's deadline has passed", () => {
    let started = 0;
    const read = createTextReads(GENEROUS, (text) => {
      started += 1;
      return parseReadme(text);
    }).forPage(performance.now() - 1);
    expect(read("**late**")).toEqual(plainText("**late**"));
    expect(started).toBe(0);
  });

  test("a read is cut at the request's deadline when that comes before the limits", () => {
    const read = createTextReads(GENEROUS, forever).forPage(performance.now() + 30);
    const { out, ms } = timed(() => read("text"));
    expect(out).toEqual(plainText("text"));
    expect(ms).toBeLessThan(30 + 1_000);
  });
});

// Review of #2013: with nothing remembered, a page of two stalling cards cost its whole 300 ms on every load, and one
// address may load a page five times a second. What a read gave is kept for the process, so the cost is paid once.
describe("what is remembered between page loads", () => {
  /** A parser that counts its calls and then does `then`. */
  function counted(then: (text: string) => Block[]) {
    const seen = { calls: 0 };
    const read = (text: string): Block[] => {
      seen.calls += 1;
      return then(text);
    };
    return { seen, read };
  }

  test("a text read on one page load is not parsed again on the next", () => {
    const { seen, read } = counted(parseReadme);
    const reads = createTextReads(GENEROUS, read);
    const first = reads.forPage(LATER)("# Once\n\nand *only* once");
    const second = reads.forPage(LATER)("# Once\n\nand *only* once");
    expect(second).toEqual(first);
    expect(first).toEqual(parseReadme("# Once\n\nand *only* once"));
    expect(seen.calls).toBe(1);
  });

  // Review of #2028: a table's lines are hashed to place looks (ADR 0110 point 5) inside the remembered read, so a
  // full card of a long table pays for its hashing on its first load only.
  test("the process's reader names each table, and a second page load neither parses nor hashes again", () => {
    const { seen, read } = counted(readCard);
    const reads = createTextReads(GENEROUS, read);
    const text = `| a |\n| - |\n${"| 1 |\n".repeat(999)}`;
    const [first] = reads.forPage(LATER)(text);
    expect(first?.kind === "table" && first.name?.split(" ").length).toBe(1_000);
    expect(reads.forPage(LATER)(text)).toEqual([first]);
    expect(seen.calls).toBe(1);
    expect(createTextReads(GENEROUS).forPage(LATER)(text)).toEqual([first]);
  });

  // Every page load that asks gets the one kept copy, so a page that changed it would change it for all.
  test("what a read gave cannot be changed by the page that gets it", () => {
    const reads = createTextReads(GENEROUS);
    const text = "- a [link](https://a.example) in a *list*\n\n| a |\n| - |\n| 1 |";
    const blocks = reads.forPage(LATER)(text);
    const all = (value: unknown): object[] =>
      typeof value !== "object" || value === null ? [] : [value, ...Object.values(value).flatMap(all)];
    expect(all(blocks).length).toBeGreaterThan(10);
    expect(all(blocks).filter((node) => !Object.isFrozen(node))).toEqual([]);
    expect(() => (blocks as Block[]).push({ kind: "rule" })).toThrow(TypeError);
    expect(reads.forPage(LATER)(text)).toEqual(readCard(text));
  });

  // SvelteKit writes a page's data with devalue, which writes a value it meets twice once and then refers to it
  // (tests/integration/web/public never_more_cards_than_the_owner_page_reads went red on that). Two cards with the
  // same words must not change the shape of the page's data, so each further use on one page is a copy.
  test("one text twice on a page is parsed once and shares nothing between its two cards", () => {
    const { seen, read } = counted(parseReadme);
    const page = createTextReads(GENEROUS, read).forPage(LATER);
    const text = "- the *same* [words](https://a.example)";
    const [first, second, third] = [page(text), page(text), page(text)];
    expect(seen.calls).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    const all = (value: unknown): object[] =>
      typeof value !== "object" || value === null ? [] : [value, ...Object.values(value).flatMap(all)];
    const met = new Set([...all(first), ...all(second), ...all(third)]);
    expect(met.size).toBe(3 * all(first).length);
  });

  test("a text stopped at a card's limit is not parsed again on the next page load, and stays plain", () => {
    const { seen, read } = counted(forever);
    const reads = createTextReads({ textMs: 20, pageMs: 100, ...KEPT }, read);
    expect(reads.forPage(LATER)("stalls")).toEqual(plainText("stalls"));
    const again = timed(() => reads.forPage(LATER)("stalls"));
    expect(again.out).toEqual(plainText("stalls"));
    expect(seen.calls).toBe(1);
    expect(again.ms).toBeLessThan(20);
  });

  // The page's real limits and the real parser: the second load of each stalling text runs no parse at all.
  test.each(["_*", "+ ", "1. "])("the real parser stalls on %j repeated once for the process", (shape) => {
    const text = repeated(shape);
    const { seen, read } = counted(parseReadme);
    const reads = createTextReads(TEXT_READ_LIMITS, read);
    expect(reads.forPage(LATER)(text)).toEqual(plainText(text));
    const again = timed(() => reads.forPage(LATER)(text));
    expect(again.out).toEqual(plainText(text));
    expect(seen.calls).toBe(1);
    expect(again.ms).toBeLessThan(TEXT_READ_LIMITS.textMs / 2);
  });

  // A read cut short by what was left of the page's limit, or by the request's deadline, says nothing about the
  // text: the next page load reads it, in full.
  test("a text cut short by the page's limit or the request's deadline is read on the next load", () => {
    const slow = (text: string): Block[] => {
      const until = performance.now() + 30;
      while (performance.now() < until) {
        // Works for 30 ms, then ends.
      }
      return parseReadme(text);
    };
    const reads = createTextReads({ textMs: 1_000, pageMs: 45, ...KEPT }, slow);
    const page = reads.forPage(LATER);
    expect(page("**a**")).toEqual(parseReadme("**a**"));
    expect(page("**b**")).toEqual(plainText("**b**"));
    expect(reads.forPage(LATER)("**b**")).toEqual(parseReadme("**b**"));
    expect(reads.forPage(performance.now() + 10)("**c**")).toEqual(plainText("**c**"));
    expect(reads.forPage(LATER)("**c**")).toEqual(parseReadme("**c**"));
  });

  // Nothing is kept for ever: a busy moment can stop a text that is merely long, and a text a member deleted should
  // leave the process's memory by itself.
  test.each([
    ["a stopped text", forever],
    ["a read text", parseReadme],
  ])("%s is read afresh once keptForMs has passed", (_name, parser) => {
    let now = 1_000;
    const { seen, read } = counted(parser);
    const reads = createTextReads({ textMs: 20, pageMs: 100, keptBytes: 50_000_000, keptForMs: 500 }, read, () => now);
    const first = reads.forPage(LATER)("some *text*");
    now += 499;
    expect(reads.forPage(LATER)("some *text*")).toEqual(first);
    expect(seen.calls).toBe(1);
    now += 1;
    expect(reads.forPage(LATER)("some *text*")).toEqual(first);
    expect(seen.calls).toBe(2);
  });

  // A text nobody asks for again would otherwise stay until newer ones pushed it out. The process sweeps on a timer
  // (compose.ts), so a text a member changed or deleted is gone from this memory soon after keptForMs.
  test("a sweep drops what is past its time, asked for again or not", () => {
    let now = 1_000;
    const reads = createTextReads({ ...GENEROUS, keptForMs: 500 }, parseReadme, () => now);
    const page = reads.forPage(Number.POSITIVE_INFINITY);
    page("first");
    now += 300;
    page("second");
    expect(reads.sweep()).toBe(2);
    now += 200;
    expect(reads.sweep()).toBe(1);
    now += 300;
    expect(reads.sweep()).toBe(0);
  });

  // What a text weighs is the reader's own upper estimate (text-reader.ts `bytesIn`). Each text below reads to 100
  // paragraphs of one run each and weighs about 42,000 bytes by it, so three fit in 150,000 and four do not.
  test("at most keptBytes are kept, and the text read longest ago is dropped first", () => {
    const { seen, read } = counted(parseReadme);
    const reads = createTextReads({ ...GENEROUS, keptBytes: 150_000 }, read);
    const page = reads.forPage(LATER);
    const text = (name: string) => `${"word\n\n".repeat(99)}${name}`;
    for (const name of ["one", "two", "three"]) page(text(name));
    expect(seen.calls).toBe(3);
    // "one" is read again, so "two" is now the oldest; a fourth text pushes "two" out and nothing else.
    page(text("one"));
    page(text("four"));
    expect(seen.calls).toBe(4);
    for (const name of ["one", "three", "four"]) page(text(name));
    expect(seen.calls).toBe(4);
    page(text("two"));
    expect(seen.calls).toBe(5);
  });

  test("a result larger than keptBytes is given but not kept", () => {
    const { seen, read } = counted(parseReadme);
    const reads = createTextReads({ ...GENEROUS, keptBytes: 20_000 }, read);
    const long = "word\n\n".repeat(60);
    expect(reads.forPage(LATER)(long)).toEqual(parseReadme(long));
    reads.forPage(LATER)(long);
    expect(seen.calls).toBe(2);
  });

  // A full card that is one paragraph is two objects and 20,000 characters: counted by its objects alone it weighed
  // nothing, and thousands of them were kept (Codex on #2013). At two bytes a character, for the text and again for
  // the string in the result, each weighs about 81,500 bytes, so three fit in 250,000.
  test("a kept result weighs its strings, not only its objects", () => {
    const reads = createTextReads({ ...GENEROUS, keptBytes: 250_000 });
    const page = reads.forPage(LATER);
    for (let card = 0; card < 10; card += 1) page(`${"a".repeat(19_990)} ${card}`);
    expect(reads.sweep()).toBe(3);
  });

  // A short string in a result can be a slice that holds the whole text it was cut from in memory (measured: 57
  // characters of result held 39 KB). So the text counts too: these read to one short paragraph, the link
  // definitions after it are dropped, and each still weighs about 41,000 bytes, so two fit in 100,000.
  test("a kept result weighs the text it was read from", () => {
    const reads = createTextReads({ ...GENEROUS, keptBytes: 100_000 });
    const page = reads.forPage(LATER);
    const definitions = "[x]: <y> 'z'\n\n".repeat(1_400);
    for (let card = 0; card < 5; card += 1) {
      expect(page(`fourteen chars ${card}\n\n${definitions}`)).toEqual(parseReadme(`fourteen chars ${card}`));
    }
    expect(reads.sweep()).toBe(2);
  });

  test("a stopped text weighs next to nothing, however long it is", () => {
    const reads = createTextReads({ ...GENEROUS, textMs: 20, pageMs: 10_000, keptBytes: 20_000 }, forever);
    const page = reads.forPage(LATER);
    for (let card = 0; card < 5; card += 1) page(`${"a".repeat(19_990)} ${card}`);
    expect(reads.sweep()).toBe(5);
  });

  test("texts that differ only past the reader's 20,000 characters are one text", () => {
    const { seen, read } = counted(parseReadme);
    const reads = createTextReads(GENEROUS, read);
    const head = "a".repeat(20_000);
    reads.forPage(LATER)(`${head}one`);
    reads.forPage(LATER)(`${head}two`);
    expect(seen.calls).toBe(1);
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

  // What is kept is tens of megabytes, never hundreds, and a result is kept between one minute and an hour. A full
  // card as a dense list weighs about 660,000 bytes by the reader's estimate, so ten of them are all kept.
  test("what is kept is tens of megabytes, holds full cards, and is kept for minutes", () => {
    expect(TEXT_READ_LIMITS.keptBytes).toBeGreaterThanOrEqual(16_000_000);
    expect(TEXT_READ_LIMITS.keptBytes).toBeLessThanOrEqual(128_000_000);
    const reads = createTextReads({ ...GENEROUS, keptBytes: TEXT_READ_LIMITS.keptBytes });
    const page = reads.forPage(LATER);
    for (let card = 0; card < 10; card += 1) page(`${repeated(formatted).slice(0, -3)}${card}`);
    expect(reads.sweep()).toBe(10);
    expect(TEXT_READ_LIMITS.keptForMs).toBeGreaterThanOrEqual(60_000);
    expect(TEXT_READ_LIMITS.keptForMs).toBeLessThanOrEqual(3_600_000);
  });
});
