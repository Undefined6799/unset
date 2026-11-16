// `/health` (P1.04k): 200 with the service and commit when ready, 503 otherwise. Container and `docker-rollout`
// probes read it, so it reveals nothing else.

/** A readiness check. A throw, a rejection or a check slower than 1 s counts as not ready (fail closed). */
export type Readiness = () => Promise<boolean>;
export type HealthState = "starting" | "running" | "draining";

const CHECK_TIMEOUT_MS = 1000;
const CACHE_MS = 2000;

async function passes(check: Readiness): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([check().catch(() => false), timeout])) === true;
  } finally {
    clearTimeout(timer);
  }
}

export function createHealth(options: {
  service: string;
  commit: string;
  checks: readonly Readiness[];
  now: () => number;
}) {
  let state: HealthState = "starting";
  let everReady = false;
  let cached: { at: number; ready: boolean } | undefined;

  let inFlight: Promise<boolean> | undefined;

  const runChecks = async (now: number): Promise<boolean> => {
    const results = await Promise.all(options.checks.map(passes));
    cached = { at: now, ready: results.every(Boolean) };
    everReady ||= cached.ready;
    return cached.ready;
  };

  /** One run of the checks at a time: probes that arrive while it is pending share its answer (P1.04y). */
  const ready = (): Promise<boolean> => {
    const now = options.now();
    if (cached && now - cached.at < CACHE_MS) return Promise.resolve(cached.ready);
    inFlight ??= runChecks(now).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const body = (status: string, code: number) =>
    Response.json(
      { status, service: options.service, commit: options.commit },
      { status: code, headers: { "cache-control": "no-store" } },
    );

  return {
    setState: (next: HealthState) => {
      state = next;
    },
    get state() {
      return state;
    },
    /** In-process requests (tests, `request()`) never listen, so `starting` and `running` both run the checks. */
    respond: async (): Promise<Response> => {
      if (state === "draining") return body("draining", 503);
      if (await ready()) return body("ok", 200);
      return body(everReady ? "unready" : "starting", 503);
    },
  };
}
