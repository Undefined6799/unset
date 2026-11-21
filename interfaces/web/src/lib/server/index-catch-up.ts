// The privacy save's short wait for the index (staging break test 2026-11-21, second pass). The save writes the
// member's choice to their PDS, but the public page reads only the index, which the indexer updates from the PDS's
// stream a second or two later (ADR 0052). So the save waits, a few seconds at most and inside the request's own
// deadline (rule RE-1), until the index has the choice before it says "Privacy saved"; if the wait runs out it says
// the page is catching up instead. Reads only; nothing here runs inside a transaction (rule DA-4).
import { type ProfileVisibility, readProfileVisibility } from "@unset/domains-profile";

/** The longest the save waits for the index before it answers anyway. */
export const CATCH_UP_MS = 5_000;
/** Between two reads of the index. */
const STEP_MS = 250;

export type CatchUpDeps = {
  /** The member's profile record as the public page reads it, or null when the index shows no page for them. */
  readonly read: (signal: AbortSignal) => Promise<unknown>;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The request's deadline: the wait never outlives it. */
  readonly signal: AbortSignal;
};

/**
 * Whether the public page already follows `wanted`. A member the index shows no page for has nothing to catch up (the
 * public page is a 404 either way). A read that fails counts as not yet, so the answer never claims more than is known.
 */
export async function publicPageShows(wanted: ProfileVisibility, deps: CatchUpDeps): Promise<boolean> {
  const until = deps.now() + CATCH_UP_MS;
  for (;;) {
    if (deps.signal.aborted) return false;
    const record = await deps.read(deps.signal).catch(() => undefined);
    if (record === null) return true;
    if (record !== undefined && readProfileVisibility(record) === wanted) return true;
    if (deps.now() + STEP_MS > until) return false;
    await deps.sleep(STEP_MS, deps.signal);
  }
}

/** A sleep that ends early, without throwing, when `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
