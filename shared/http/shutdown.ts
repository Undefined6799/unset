// Graceful shutdown (P1.04k): stop accepting, let in-flight requests finish within the grace period, run the close
// hooks, and report the exit code. A second signal during the drain exits at once.
export type CloseHook = () => Promise<void>;
/** The parts of Node's HTTP server a drain needs. */
export type Drainable = { close(): unknown; closeIdleConnections(): void; closeAllConnections(): void };

const HOOK_TIMEOUT_MS = 5000;
const POLL_MS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runHook(hook: CloseHook): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), HOOK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      hook().then(
        () => true,
        () => false,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drains `server`: no new connections, idle keep-alive sockets closed, in-flight requests given `graceMs`. Returns 0
 * when every request finished, 1 when some were destroyed at the deadline. Hooks run either way (DB pools later).
 */
export async function drain(
  server: Drainable,
  options: { graceMs: number; inFlight: () => number; hooks: readonly CloseHook[] },
): Promise<0 | 1> {
  server.close();
  server.closeIdleConnections();
  const deadline = performance.now() + options.graceMs;
  while (options.inFlight() > 0 && performance.now() < deadline) await sleep(POLL_MS);
  const finished = options.inFlight() === 0;
  if (!finished) server.closeAllConnections();
  for (const hook of options.hooks) await runHook(hook);
  return finished ? 0 : 1;
}

/** The first SIGTERM or SIGINT starts `onSignal` and exits with its code; a second one exits 1 immediately. */
export function exitOnSignals(onSignal: () => Promise<0 | 1>, exit: (code: number) => void): void {
  let draining = false;
  const handle = () => {
    if (draining) return exit(1);
    draining = true;
    onSignal().then(exit, () => exit(1));
  };
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}
