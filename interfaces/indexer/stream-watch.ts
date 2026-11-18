// Whether the stream reader is getting anywhere (book P3.05s PR 3, health). The reader never gives up: it reports
// each stop and dials again after a wait that doubles up to INDEXER_MAX_RESTART_DELAY_MS. So "down for good" shows as
// stops that keep coming with no frame applied in between. A quiet PDS sends no frames, so silence alone is not a
// fault: once no stop has come for two of the longest waits, the dial held and the streak is over.
//
// The process is unhealthy when such a streak has lasted longer than `unhealthyAfterMs`; the image's HEALTHCHECK
// then fails and the operator sees it, instead of an indexer that answers 200 while it reads nothing.

export type StreamWatchOptions = {
  /** INDEXER_MAX_RESTART_DELAY_MS: the reader's longest wait between dials. */
  readonly maxRestartDelayMs: number;
  /** INDEXER_STREAM_UNHEALTHY_MS */
  readonly unhealthyAfterMs: number;
  readonly now: () => number;
};

export type StreamWatch = {
  /** Called on each stop the reader reports. */
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
    if (streakSince === null || now - lastStop > 2 * options.maxRestartDelayMs) return null;
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
