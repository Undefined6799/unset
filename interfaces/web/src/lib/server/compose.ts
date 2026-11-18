// The web process's composition root (rule AB-2): the one place adapters are built. Everything is built on first use,
// not at import, because SvelteKit imports every server module while it builds, with no settings (kit 3.2.0
// src/core/postbuild/analyse.js). A slice that needs a new service adds it here; pages get it through `services()`.
import { connectionOf, createPool, type Pool, ping, withClient } from "@unset/infrastructure-postgres";
import { createSessionStore, type SessionStore } from "@unset/infrastructure-session";
import { createHealth, createRateLimiter, type RateLimiter } from "@unset/shared-http";
import { createLogger, type Logger } from "@unset/shared-log";
import { policiesFor } from "./limits.ts";
import { config, shutdown } from "./runtime.ts";

/** How often idle rate-limit buckets are dropped. */
const SWEEP_MS = 10_000;
/** Under the health check's 1 s bound (shared/http/health.ts), so the probe is ended, not left behind. */
const READINESS_MS = 900;

export type Services = {
  readonly log: Logger;
  readonly pool: Pool;
  readonly sessions: SessionStore;
  readonly limiter: RateLimiter;
  readonly health: ReturnType<typeof createHealth>;
};

function build(): Services {
  const log: Logger = createLogger({ service: "web", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
  const pool = createPool({
    connection: connectionOf(config),
    service: "web",
    max: config.PG_POOL_MAX,
    connectTimeoutMs: config.PG_CONNECT_TIMEOUT_MS,
  });
  const sessions = createSessionStore({
    withDb: (deadline, fn) => withClient(pool, deadline, fn),
    limits: {
      idleS: config.SESSION_IDLE_S,
      absoluteS: config.SESSION_ABSOLUTE_S,
      touchIntervalS: config.SESSION_TOUCH_INTERVAL_S,
    },
    log,
  });
  const limiter: RateLimiter = createRateLimiter(policiesFor(config.TRUSTED_PROXY_MODE), {
    maxKeys: config.RATE_LIMIT_MAX_KEYS,
    onError: () => log.error("ratelimit.error", {}),
  });
  const sweeper = setInterval(() => limiter.sweep(), SWEEP_MS);
  sweeper.unref();
  const health = createHealth({
    service: config.UNSET_SERVICE,
    commit: config.UNSET_COMMIT,
    checks: [() => ping(pool, AbortSignal.timeout(READINESS_MS)).then(() => true)],
    now: () => performance.now(),
  });
  health.setState("running");
  shutdown.draining.push(() => health.setState("draining"));
  shutdown.close.push(
    async () => clearInterval(sweeper),
    () => pool.end(),
  );
  return { log, pool, sessions, limiter, health };
}

let built: Services | undefined;

export const services = (): Services => {
  built ??= build();
  return built;
};
