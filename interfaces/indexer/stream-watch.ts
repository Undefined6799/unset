// Whether the stream reader is getting anywhere (book P3.05s PR 3, health). The reader never gives up: it reports each
// stop, and each dial the library retries by itself (reader.ts onRetry: an unreachable PDS shows only there), and dials
// again after a wait capped at INDEXER_MAX_RESTART_DELAY_MS. So "down for good" shows as failures that keep coming with
// no frame applied in between. A quiet PDS sends no frames, so silence alone is not a fault: once no failure has come
// for `streakEndsAfterMs` (two of the longest waits plus the longest a dial can hang), the dial held and the streak is
// over.
//
// The process is unhealthy when such a streak has lasted longer than `unhealthyAfterMs`; the image's HEALTHCHECK
// then fails and the operator sees it, instead of an indexer that answers 200 while it reads nothing.

/**
 * The longest one dial can hang before it fails: Linux gives up a TCP connect after about 127 s at the default
 * net.ipv4.tcp_syn_retries of 6 (tcp(7)); a refused or unresolvable dial fails at once.
 */
export const DIAL_ALLOWANCE_MS = 150_000;

/** How long with no failure ends a streak; config requires INDEXER_STREAM_UNHEALTHY_MS above it (config.ts). */
export const streakEndsAfterMs = (maxRestartDelayMs: number): number => 2 * maxRestartDelayMs + DIAL_ALLOWANCE_MS;

export type StreamWatchOptions = {
  /** INDEXER_MAX_RESTART_DELAY_MS: the reader's longest wait between dials. */
  readonly maxRestartDelayMs: number;
  /** INDEXER_STREAM_UNHEALTHY_MS */
  readonly unhealthyAfterMs: number;
  readonly now: () => number;
};

export type StreamWatch = {
  /** Called on each stop or retried dial the reader reports. */
  readonly stopped: () => void;
  /** Called after each frame the consumer applied. */
  readonly applied: () => void;
  /** Milliseconds the current streak of stops has lasted, or null when there is none. */
  readonly failingForMs: () => number | null;
  readonly healthy: () => boolean;
};

export function streamWatch(options: StreamWatchOptions): StreamWatch {
  let streakSince: number | null = null;
  let lastStop = 0;
  const failingForMs = (): number | null => {
    const now = options.now();
    if (streakSince === null || now - lastStop > streakEndsAfterMs(options.maxRestartDelayMs)) return null;
    return now - streakSince;
  };
  return {
    stopped: () => {
      if (failingForMs() === null) streakSince = options.now();
      lastStop = options.now();
    },
    applied: () => {
      streakSince = null;
    },
    failingForMs,
    healthy: () => (failingForMs() ?? 0) <= options.unhealthyAfterMs,
  };
}
