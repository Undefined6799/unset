// The indexer process's loop (book P3.05s PR 3; ADR 0052): the stream reader first, then the passes on a timer. The
// stream starts before the first backfill pass, so a commit made while a repo is read is never missed: it is either in
// the repo or arrives on the stream after it, and the rev guards apply the two in either order (track.ts).
//
// Each pass runs to its end before the next tick; a pass that throws (the database unreachable, say) is counted on
// health and the loop goes on. Nothing here logs a DID, handle or record (SE-7): passes return counts, and failures are
// counted by pass name only.

/** What a tick runs, in order. Each returns the pass's own counts, which health keeps as the last result. */
export type Passes = Readonly<Record<PassName, () => Promise<Readonly<Record<string, number>>>>>;
export type PassName = "track" | "backfill" | "confirm";
const PASS_ORDER: readonly PassName[] = ["track", "backfill", "confirm"];

export type RunDeps = {
  /** Starts the stream reader and resolves when it has stopped for good (the signal aborted). */
  readonly stream: (signal: AbortSignal) => Promise<void>;
  readonly passes: Passes;
  /** Milliseconds between the end of one tick and the start of the next. */
  readonly intervalMs: number;
};

/** What the loop has seen since the process started; no DID, handle or content. */
export type RunHealth = {
  readonly ticks: number;
  /** Passes that threw, by name, since start: a pass that keeps failing shows here (carry from #1713's review). */
  readonly passFailures: Readonly<Record<PassName, number>>;
  /** Each pass's counts from its last run that finished. */
  readonly lastPass: Readonly<Partial<Record<PassName, Readonly<Record<string, number>>>>>;
};

export type Runner = { readonly done: Promise<void>; readonly health: () => RunHealth };

export function runIndexer(deps: RunDeps, signal: AbortSignal): Runner {
  let ticks = 0;
  const passFailures: Record<PassName, number> = { track: 0, backfill: 0, confirm: 0 };
  const lastPass: Partial<Record<PassName, Readonly<Record<string, number>>>> = {};

  const tick = async (): Promise<void> => {
    for (const name of PASS_ORDER) {
      if (signal.aborted) return;
      try {
        lastPass[name] = await deps.passes[name]();
      } catch {
        passFailures[name] += 1;
      }
    }
    ticks += 1;
  };

  const loop = async (): Promise<void> => {
    while (!signal.aborted) {
      await tick();
      await sleep(deps.intervalMs, signal);
    }
  };

  // The stream first: started (not awaited) before the first tick.
  const stream = deps.stream(signal);
  const done = Promise.all([stream, loop()]).then(() => undefined);
  return {
    done,
    health: () => ({ ticks, passFailures: { ...passFailures }, lastPass: { ...lastPass } }),
  };
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
