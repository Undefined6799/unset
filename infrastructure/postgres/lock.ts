// The per-key advisory lock (P1.17; plan §5.2; review 02 SERIOUS-5): work keyed on one DID, above all an OAuth token
// refresh, runs in at most one place at a time across every `web` replica, so two replicas never spend the same
// refresh token. A transaction-level lock in the two-int4 key space (namespace, hashtext(key)), which never overlaps
// the migration runner's bigint lock, and which Postgres releases when the transaction ends, however it ends
// (https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
import type { Logger } from "@unset/shared-log";
import { acquire, createPool, type Pool, type PoolClient, type PoolOptions } from "./pool.ts";
import { inTransaction } from "./tx.ts";

/** What each lock serialises: the first int4 of the lock key. Closed; a new use adds a line, never reuses a number. */
export const LockNamespace = {
  oauth: 1,
} as const;
export type LockNamespace = (typeof LockNamespace)[keyof typeof LockNamespace];

export type LockErrorCode = "lock.timeout" | "lock.lost" | "lock.pool_exhausted";

export class LockError extends Error {
  readonly code: LockErrorCode;

  constructor(code: LockErrorCode, options: { cause?: unknown } = {}) {
    super(code, options);
    this.name = "LockError";
    this.code = code;
  }
}

/** The lock holders' own pool, so waiting on a lock never takes a client from normal queries. */
export type LockPool = { readonly pool: Pool; readonly log: Logger };

/** The longest wait for a lock pool client before `lock.pool_exhausted`. */
const CLIENT_WAIT_MS = 2000;
const LOCK_NOT_AVAILABLE = "55P03";
const QUERY_CANCELED = "57014";

/**
 * Builds the lock pool: `max` is LOCK_POOL_MAX (default 8), counted by `checkConnectionBudget` beside PG_POOL_MAX. The
 * timeouts are the role's, as for the process's main pool.
 */
export function createLockPool(options: Omit<PoolOptions, "connectTimeoutMs" | "onStatement"> & { log: Logger }) {
  const { log, ...poolOptions } = options;
  return { pool: createPool({ ...poolOptions, connectTimeoutMs: CLIENT_WAIT_MS }), log } satisfies LockPool;
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/**
 * Runs `fn` while holding the lock on (`namespace`, `key`) in every replica. Waits at most `waitMs` for the lock
 * (`lock.timeout`) and 2 s for a client (`lock.pool_exhausted`). `fn` past `holdMs` is logged, not aborted; the
 * transaction's idle timeout (`holdMs` + 5 s) ends it, which releases the lock.
 */
export async function withAdvisoryLock<T>(
  lock: LockPool,
  namespace: LockNamespace,
  key: string,
  fn: () => Promise<T>,
  options: { waitMs?: number; holdMs?: number } = {},
): Promise<T> {
  const waitMs = milliseconds(options.waitMs ?? 10_000);
  const holdMs = milliseconds(options.holdMs ?? 30_000);
  const client = await acquire(lock.pool, null).catch((cause: unknown) => {
    throw new LockError("lock.pool_exhausted", { cause });
  });
  // pg-pool removes its own error listener from a checked-out client (pg-pool 3.14.0 index.js:344), and a client that
  // emits `error` with no listener throws. This one marks the lock lost; the server released it with the session.
  let lost = false;
  const onLost = (): void => {
    lost = true;
  };
  client.on("error", onLost);
  client.on("end", onLost);
  const release = (broken?: unknown): void => {
    client.removeListener("error", onLost);
    client.removeListener("end", onLost);
    client.release(broken === undefined ? undefined : broken instanceof Error ? broken : true);
  };

  let outcome: Outcome<T> | undefined;
  try {
    await inTransaction(client, async () => {
      await waitForLock(client, namespace, key, waitMs, holdMs);
      outcome = await runWatched(lock.log, namespace, fn, holdMs);
      // A lost session cannot commit; throwing makes the rollback attempt fail fast into the catch below.
      if (lost) throw new LockError("lock.lost");
    });
  } catch (error) {
    if (outcome === undefined) {
      const timeout = lockTimeoutOf(error);
      // A plain lock timeout rolled back cleanly and the client is reused; anything else may have left it broken.
      release(timeout === error && !lost ? undefined : error);
      throw timeout ?? error;
    }
    // `fn` settled but COMMIT or ROLLBACK failed: the client is discarded and `fn`'s outcome still stands (step 5a, 6).
    release(error);
    if (lost) lock.log.warn("lock.lost", { kind: namespaceName(namespace) });
    else lock.log.logError(error);
    return settle(outcome);
  }
  release();
  return settle(outcome as Outcome<T>);
}

/** The OAuth client's `requestLock` (@atproto/oauth-client-node ≥0.5.8; confirmed against the pinned types in P2.04). */
export function createRequestLock(lock: LockPool) {
  return <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> =>
    withAdvisoryLock(lock, LockNamespace.oauth, name, async () => fn());
}

/**
 * Takes the lock within `waitMs`. The role's own `statement_timeout` (2 s on `web`) would cancel a longer wait first
 * with 57014, so the wait gets `waitMs` + 1 s and the role default comes back once the lock is held. SET takes no bind
 * parameters, so the values are checked integers.
 */
async function waitForLock(client: PoolClient, namespace: LockNamespace, key: string, waitMs: number, holdMs: number) {
  await client.query(
    `SET LOCAL lock_timeout = '${waitMs}ms'; SET LOCAL statement_timeout = '${waitMs + 1000}ms'; ` +
      `SET LOCAL idle_in_transaction_session_timeout = '${holdMs + 5000}ms'`,
  );
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::int4, hashtext($2))", [namespace, key]);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw code === LOCK_NOT_AVAILABLE || code === QUERY_CANCELED
      ? new LockError("lock.timeout", { cause: error })
      : error;
  }
  await client.query("RESET statement_timeout");
}

/** Runs `fn` to its outcome, logging `lock.hold_exceeded` once if it is still running at `holdMs`. */
async function runWatched<T>(log: Logger, namespace: LockNamespace, fn: () => Promise<T>, holdMs: number) {
  const watchdog = setTimeout(
    () => log.warn("lock.hold_exceeded", { kind: namespaceName(namespace), ms: holdMs }),
    holdMs,
  );
  try {
    return { ok: true, value: await fn() } as const;
  } catch (error) {
    return { ok: false, error } as const;
  } finally {
    clearTimeout(watchdog);
  }
}

function settle<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

/** A lock timeout, alone or as the first error of a failed rollback (`inTransaction` throws both together). */
function lockTimeoutOf(error: unknown): LockError | undefined {
  const first: unknown = error instanceof AggregateError ? error.errors[0] : error;
  return first instanceof LockError && first.code === "lock.timeout" ? first : undefined;
}

/** The namespace's name for a log line; the key is never logged, since it is usually a DID (SE-7). */
function namespaceName(namespace: LockNamespace): string {
  return Object.entries(LockNamespace).find(([, value]) => value === namespace)?.[0] ?? "unknown";
}

function milliseconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 600_000) throw new RangeError("lock: ms out of range");
  return value;
}
