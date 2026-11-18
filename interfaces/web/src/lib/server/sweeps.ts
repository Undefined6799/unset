// Copied from interfaces/http/jobs/sweeps.ts for the web process (P1.20e); that copy goes at P1.20k.
// web's expiry sweeps (P2.03s; whole-project review 2026-11-15, security item 2). The session store and the OAuth
// state store each had a sweep with no caller, so an expired session whose cookie never came back, and every
// abandoned sign-in, stayed for good. web runs both because web is the role that may delete from those tables
// (migrations 0011 and 0013). The single-use sweep (P1.16w) runs here too: web holds no DELETE on that table and
// calls app.sweep_single_use (migration 0023), one fixed statement, until the jobs process exists (P4.25).
// The sweeps are idempotent DELETEs (book phase-2.md P2.03, DA-4), so every replica runs them and none takes a lock.
import type { Logger } from "@unset/shared-log";

export type Sweep = {
  /** The fixed name a failure is logged under; never a table row's content. */
  readonly job: string;
  run(): Promise<unknown>;
};

type Options = {
  readonly sweeps: readonly Sweep[];
  readonly everyMs: number;
  readonly log: Pick<Logger, "error">;
};

/**
 * Runs every sweep now and then every `everyMs`, in order. The first run is at start because a deploy restarts web
 * more often than the interval. A sweep that throws is logged by its class name only (a message can carry a DID,
 * SE-7) and stops neither the rest nor the timer; the role's statement_timeout bounds each DELETE (RE-1). A tick
 * that finds the last run still going does nothing. Returns what stops the timer, for the server's close hooks.
 *
 * The timer is unref'd, so it never keeps the process alive (Node 26 doc/api/timers.md, `timeout.unref()`).
 */
export function startSweeps(options: Options): () => void {
  let running = false;
  const runAll = async () => {
    if (running) return;
    running = true;
    try {
      for (const sweep of options.sweeps) {
        await sweep.run().catch((error: unknown) => {
          const kind = error instanceof Error ? error.constructor.name : "unknown";
          options.log.error("error", { job: sweep.job, kind });
        });
      }
    } finally {
      running = false;
    }
  };
  void runAll();
  const timer = setInterval(() => void runAll(), options.everyMs).unref();
  return () => clearInterval(timer);
}
