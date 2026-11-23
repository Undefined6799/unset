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
import { createContext, Script } from "node:vm";
import { type Block, parseReadme, plainText } from "@unset/apps-web/lib/profile/parse.ts";

/**
 * How long reading Markdown may hold the process (limits.ts TEXT_READ_LIMITS): `textMs` for one card's text, `pageMs`
 * for all of one page's.
 */
export type TextReadLimits = { readonly textMs: number; readonly pageMs: number };

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

/**
 * One page's reader: each call reads a card's text as blocks within what is left of the limits and of the request
 * (`deadlineAt`, on the performance.now() clock), or gives it as plain text. `read` is the parser; tests pass their own.
 */
export function pageTextReader(
  limits: TextReadLimits,
  deadlineAt: number,
  read: (text: string) => Block[] = parseReadme,
): (text: string) => Block[] {
  let left = limits.pageMs;
  return (text) => {
    const started = performance.now();
    const ms = Math.floor(Math.min(limits.textMs, left, deadlineAt - started));
    if (ms < 1) return plainText(text);
    const outcome = within(ms, () => read(text));
    left -= performance.now() - started;
    return "value" in outcome ? outcome.value : plainText(text);
  };
}
