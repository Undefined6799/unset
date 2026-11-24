// Reading a member's Markdown inside a page load (book P1.21k). The parse is synchronous, so while it runs no other
// request moves, and micromark gives no bound of its own: its readme ("Security",
// https://github.com/micromark/micromark#security, read at 4.0.3) says small payloads can crash it and to "process
// content in a different thread or worker so that it can be stopped when needed". Measured here on Node 26.12 at
// the text block's 20,000 characters: "_*" repeated takes about 5 s, "+ " repeated about 10 s and then overflows the
// stack. A normal card takes 1 to 4 ms for each 1,000 characters.
//
// So each parse runs under a deadline it cannot outlive: node:vm's `timeout` stops synchronous JavaScript from a
// watchdog thread (Node 26 doc/api/vm.md, script.runInContext: "Specifies the number of milliseconds to execute `code`
// before terminating execution. If execution is terminated, an Error will be thrown"; it starts a thread per call, about
// 0.3 ms here). The parse stays in this thread, so there is no worker to feed or to queue behind. That page also says
// node:vm "is not a security mechanism": it is no sandbox for untrusted code, and none is run here; the code is our
// own parser and only the member's text is untrusted. Its note that promises and timers escape the timeout does not
// apply: the parse is synchronous and schedules nothing.
//
// A card stopped there is shown as plain text: every character escaped, nothing formatted. One page's cards share one
// budget, and no parse starts past the request's own deadline (rule RE-1).
//
// What a read gave is remembered for the process (review of #2013): without that a page of two stalling cards cost
// its whole budget on every load, and one address may load a page five times a second (limits.ts `default`). A text
// is now parsed once in `keptForMs`, whoever asks and however often, and a stalling one costs its limit once in that
// time. Nothing is kept longer: the process sweeps on a timer (compose.ts), so a text a member changed or deleted
// leaves this memory by itself.
import { createHash } from "node:crypto";
import { createContext, Script } from "node:vm";
import { type Block, MAX_CHARS, parseReadme, plainText } from "@unset/apps-web/lib/profile/parse.ts";

/**
 * How long reading Markdown may hold the process, and how much of it is remembered (limits.ts TEXT_READ_LIMITS).
 * `textMs` is for one card's text and `pageMs` for all of one page's. `keptBytes` is the size of what is kept between
 * page loads, by the upper estimate below (`bytesIn`). `keptForMs` is how long a result is kept, a stop at `textMs` included, before the text is read afresh.
 */
export type TextReadLimits = {
  readonly textMs: number;
  readonly pageMs: number;
  readonly keptBytes: number;
  readonly keptForMs: number;
};

// The task runs as a call from a script in a context of its own, because the timeout belongs to a script's run; the
// task itself is this realm's function, so what it returns are ordinary objects.
const context = createContext({ task: undefined as (() => unknown) | undefined });
const call = new Script("task()");
type Stopped = { readonly code?: unknown };

/**
 * Runs `task` and stops it once `ms` (a whole number, at least 1) have passed: its result, or `stopped`. An error the
 * task throws is the caller's, as without the deadline.
 */
export function within<T>(ms: number, task: () => T): { readonly value: T } | { readonly stopped: true } {
  context.task = task;
  try {
    return { value: call.runInContext(context, { timeout: ms }) as T };
  } catch (cause) {
    if ((cause as Stopped | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return { stopped: true };
    throw cause;
  } finally {
    context.task = undefined;
  }
}

/** What reading one text gave, kept until `until`: its blocks, or null for a stop at a card's whole limit. */
type Kept = { readonly blocks: readonly Block[] | null; readonly bytes: number; readonly until: number };

// What a kept text weighs is an upper estimate, never a count of objects alone: a full card that is one paragraph is
// two objects and 20,000 characters. Measured on Node 26.12 with the collector forced, for full cards: a result's
// objects and arrays take 65 to 115 bytes each beside their strings, a character takes one byte or two (V8 stores a
// string holding any character outside Latin-1 at two), and a short string in a result can be a slice that holds the
// whole text it was cut from (57 characters of result held 39 KB). So every object and array counts OBJECT_BYTES,
// every character two bytes, and the text itself counts again as if the result held it. By this a full card weighs
// about 80 KB as one paragraph (21 to 41 KB measured), 180 KB as prose (107), 660 KB as a dense list (449) and
// 960 KB as a table (850).
const OBJECT_BYTES = 120;
const CHAR_BYTES = 2;
/** What every kept text weighs besides its result: its key, its entry and its place in the map. */
const ENTRY_BYTES = 1_000;

/** The upper estimate of what a read result holds in memory, the text it was read from not counted. */
function bytesIn(value: unknown): number {
  if (typeof value === "string") return CHAR_BYTES * value.length;
  if (typeof value !== "object" || value === null) return 0;
  let bytes = OBJECT_BYTES;
  for (const inner of Object.values(value)) bytes += bytesIn(inner);
  return bytes;
}

/** Freezes a read result all the way down: every page load that asks gets this one copy, so none may change it. */
function frozen<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const inner of Object.values(value)) frozen(inner);
  return Object.freeze(value);
}

/** One text's name in what is kept: the parser reads no further than MAX_CHARS, so neither does the name. */
const keyOf = (text: string): string => createHash("sha256").update(text.slice(0, MAX_CHARS)).digest("base64url");

/**
 * The process's reader of Text cards. `forPage` gives one page load its reader. `sweep` drops every kept result past
 * its time, asked for again or not, and says how many texts are still kept.
 */
export type TextReads = {
  readonly forPage: (deadlineAt: number) => (text: string) => readonly Block[];
  readonly sweep: () => number;
};

/**
 * The reader a process keeps (compose.ts builds the one). `forPage` gives a page load its reader: each call reads a
 * card's text as blocks, from what is kept or by parsing within what is left of the limits and of the request
 * (`deadlineAt`, on `now`'s clock), or gives it as plain text. `read` is the parser and `now` the clock, in
 * milliseconds; tests pass their own.
 */
export function createTextReads(
  limits: TextReadLimits,
  read: (text: string) => Block[] = parseReadme,
  now: () => number = () => performance.now(),
): TextReads {
  // In the order they were last read, oldest first (a Map keeps insertion order).
  const kept = new Map<string, Kept>();
  let bytes = 0;
  const forget = (key: string): void => {
    bytes -= kept.get(key)?.bytes ?? 0;
    kept.delete(key);
  };
  const keep = (key: string, entry: Kept): void => {
    forget(key);
    kept.set(key, entry);
    bytes += entry.bytes;
    for (const oldest of kept.keys()) {
      if (bytes <= limits.keptBytes) break;
      forget(oldest);
    }
  };
  const recall = (key: string): Kept | undefined => {
    const entry = kept.get(key);
    if (entry === undefined) return undefined;
    if (entry.until <= now()) {
      forget(key);
      return undefined;
    }
    // Read just now, so the last to be dropped.
    kept.delete(key);
    kept.set(key, entry);
    return entry;
  };

  return {
    sweep() {
      const at = now();
      for (const [key, entry] of kept) if (entry.until <= at) forget(key);
      return kept.size;
    },
    forPage(deadlineAt) {
      let left = limits.pageMs;
      // A page that holds one text twice gets a copy of its own for each further use: SvelteKit writes a load's
      // result into the page with devalue, which writes a value met twice once and then refers to it, and a page's
      // data should not take another shape because two of its cards hold the same words.
      const given = new Set<string>();
      const once = (key: string, blocks: readonly Block[]): readonly Block[] => {
        if (given.has(key)) return structuredClone(blocks);
        given.add(key);
        return blocks;
      };
      return (text) => {
        const started = now();
        const key = keyOf(text);
        const known = recall(key);
        if (known !== undefined) return known.blocks === null ? plainText(text) : once(key, known.blocks);
        const ms = Math.floor(Math.min(limits.textMs, left, deadlineAt - started));
        if (ms < 1) return plainText(text);
        const outcome = within(ms, () => read(text));
        left -= now() - started;
        if ("value" in outcome) {
          const blocks = frozen(outcome.value);
          const weight = ENTRY_BYTES + CHAR_BYTES * text.length + bytesIn(blocks);
          keep(key, { blocks, bytes: weight, until: now() + limits.keptForMs });
          return once(key, blocks);
        }
        // Only a read that had a card's whole limit says the text itself is slow. One cut short by what was left of
        // the page's budget or of the request says nothing about it, and the next page load reads it.
        if (ms >= limits.textMs) keep(key, { blocks: null, bytes: ENTRY_BYTES, until: now() + limits.keptForMs });
        return plainText(text);
      };
    },
  };
}
