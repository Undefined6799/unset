// Shares one in-flight lookup between callers asking about the same DID (P1.33r; architecture ruling
// unset-plan/book-edits/2026-10-14-outside-review-lows.md, item 2). The resolver keeps one, and the handle verifier is
// to keep its own. The flight runs on its own: the network's timeout bounds it, and no caller's abort cancels it for
// the others.

/** Tells a running task whether it still owns its DID, so a flight that was superseded never writes its cache. */
export type StillCurrent = () => boolean;

export function createInFlight<K, T>(max: number) {
  const flights = new Map<K, Promise<T>>();
  // A task that found the map full owns no entry; it may write only if no fresh call or drop happened since it began.
  let epoch = 0;

  return {
    /**
     * Joins the DID's flight, or starts `task` as a new one. A `fresh` call never joins: it must read after now, so it
     * starts its own flight, which later callers join. When the map is full, a new DID runs `task` alone, as before.
     */
    share(key: K, fresh: boolean, task: (stillCurrent: StillCurrent) => Promise<T>): Promise<T> {
      const joined = fresh ? undefined : flights.get(key);
      if (joined !== undefined) return joined;
      if (fresh) epoch += 1;
      const registered = flights.has(key) || flights.size < max;
      const began = epoch;
      const stillCurrent = registered ? () => flights.get(key) === flight : () => epoch === began;
      const flight: Promise<T> = task(stillCurrent).finally(() => {
        if (flights.get(key) === flight) flights.delete(key);
      });
      flight.catch(() => {
        // Each caller handles the outcome it awaits; this keeps a flight whose callers all detached from becoming an
        // unhandled rejection.
      });
      if (registered) flights.set(key, flight);
      return flight;
    },
    /** The next call starts a new flight, and the running one no longer writes its result. */
    drop(key: K): void {
      epoch += 1;
      flights.delete(key);
    },
  };
}

/** The flight's outcome, or `aborted()` once the caller's signal fires; the flight itself carries on for the others. */
export function awaitFlight<T>(flight: Promise<T>, signal: AbortSignal | undefined, aborted: () => T): Promise<T> {
  if (signal === undefined) return flight;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        resolve(aborted());
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    flight.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
