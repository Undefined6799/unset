// Shares one in-flight lookup between callers asking about the same DID (P1.33r; architecture ruling
// unset-plan/book-edits/2026-10-14-outside-review-lows.md, item 2). The resolver keeps one, and the handle verifier is
// to keep its own. The flight runs on its own: the network's timeout bounds it, and no caller's abort cancels it for
// the others.

/**
 * Asked by a running task just before it writes its cache: true when no lookup for the DID that started later has
 * written, and no drop came since this one started. A true answer records the write, so call it only to write.
 */
export type MayWrite = () => boolean;

export function createInFlight<K, T>(max: number) {
  const flights = new Map<K, Promise<T>>();
  // Cache writes are ordered by when each lookup started, not by which one holds the map entry: an older lookup's
  // success still lands when a newer one fails (verify-864-3048c2f B1). Per DID, only while any lookup for it runs:
  // how many run, the start number of the latest-started lookup that wrote, and the start number at the last drop.
  const order = new Map<K, { running: number; written: number; dropped: number }>();
  let started = 0;

  const begin = (key: K): number => {
    const entry = order.get(key) ?? { running: 0, written: 0, dropped: 0 };
    entry.running += 1;
    order.set(key, entry);
    started += 1;
    return started;
  };

  const end = (key: K): void => {
    const entry = order.get(key);
    if (entry === undefined) return;
    entry.running -= 1;
    if (entry.running === 0) order.delete(key);
  };

  return {
    /**
     * Joins the DID's flight, or starts `task` as a new one. A `fresh` call never joins: it must read after now, so it
     * starts its own flight, which later callers join. When the map is full, a new DID runs `task` alone, as before.
     */
    share(key: K, fresh: boolean, task: (mayWrite: MayWrite) => Promise<T>): Promise<T> {
      const joined = fresh ? undefined : flights.get(key);
      if (joined !== undefined) return joined;
      const startedAt = begin(key);
      const mayWrite: MayWrite = () => {
        const entry = order.get(key);
        if (entry === undefined || startedAt <= entry.written || startedAt <= entry.dropped) return false;
        entry.written = startedAt;
        return true;
      };
      let flight: Promise<T>;
      flight = task(mayWrite).finally(() => {
        end(key);
        if (flights.get(key) === flight) flights.delete(key);
      });
      flight.catch(() => {
        // Each caller handles the outcome it awaits; this keeps a flight whose callers all detached from becoming an
        // unhandled rejection.
      });
      if (flights.has(key) || flights.size < max) flights.set(key, flight);
      return flight;
    },
    /** The next call starts a new flight, and no lookup already running for the DID writes its result. */
    drop(key: K): void {
      flights.delete(key);
      const entry = order.get(key);
      if (entry !== undefined) entry.dropped = started;
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
