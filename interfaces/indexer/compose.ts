// The indexer process's composition root (book P3.05s PR 3; rule AB-2; scripts/guards/composition-root.ts): the one
// place its adapters are built. With INDEXER_ENABLED off it builds nothing, so the process opens no pool and reads
// nothing (ADR 0052 decision 7). On, the pool's connection budget is checked first: a pool the role's connection limit
// cannot hold across PG_MAX_REPLICAS is a ConfigError, which main.ts turns into exit 78 as web does.
import { createDidResolver, type Did, IdentityError } from "@unset/domains-identity";
import { createRepoReader, createRepoStatusReader, readFirehose } from "@unset/infrastructure-firehose";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { createIdentityNetwork } from "@unset/infrastructure-pds";
import {
  checkConnectionBudget,
  connectionOf,
  createAccountStore,
  createIndexStore,
  createPool,
  createTrackStore,
  withClient,
} from "@unset/infrastructure-postgres";
import type { Logger } from "@unset/shared-log";
import { confirmPass } from "./account-jobs.ts";
import type { IndexerConfig } from "./config.ts";
import { indexConsumer } from "./consumer.ts";
import { HEALTH_CACHE_MS, type HealthRead, sharedRead } from "./health.ts";
import { runIndexer } from "./run.ts";
import { streamWatch } from "./stream-watch.ts";
import { BACKFILL_COLLECTIONS, backfillPass, type TrackRetries, trackPass } from "./track.ts";

/** What main.ts starts: health's read, and `done`, which resolves once the signal has stopped everything. */
export type Indexer = { readonly health: HealthRead; readonly done: Promise<void> };

/** What an off process serves: health only, with no pool behind it. */
const DISABLED: Indexer = { health: async () => ({ healthy: true, enabled: false }), done: Promise.resolve() };

/**
 * Builds the adapters and starts the stream, then the passes; the signal stops both, and the pool ends after. Rejects,
 * with the pool ended, when the connection budget check fails.
 */
export async function compose(config: IndexerConfig, log: Logger, signal: AbortSignal): Promise<Indexer> {
  if (!config.INDEXER_ENABLED) return DISABLED;
  const pool = createPool({
    connection: connectionOf(config),
    service: "indexer",
    max: config.PG_POOL_MAX,
    connectTimeoutMs: config.PG_CONNECT_TIMEOUT_MS,
  });
  try {
    await withClient(pool, null, (db) => checkConnectionBudget(db, [config.PG_POOL_MAX], config.PG_MAX_REPLICAS));
  } catch (error) {
    await pool.end();
    throw error;
  }
  const guard = createNetGuard({
    internalHosts: config.NETGUARD_INTERNAL_HOSTS,
    allowLoopback: config.NETGUARD_ALLOW_LOOPBACK,
    commit: config.UNSET_COMMIT,
  });
  const plcUrl = new URL(config.PLC_URL);
  const network = createIdentityNetwork({
    guard,
    plcUrl,
    httpTimeoutMs: config.IDENTITY_HTTP_TIMEOUT_MS,
    dnsTimeoutMs: config.IDENTITY_DNS_TIMEOUT_MS,
  });
  const resolveDid = createDidResolver({
    network,
    plcUrl,
    cacheTtlS: config.DID_DOC_CACHE_TTL_S,
    cacheMax: config.DID_DOC_CACHE_MAX,
  });
  /** The DID's atproto signing key as a did:key (atproto.com/specs/cryptography, "Public Key Encoding"). */
  const signingKey = async (did: string, { fresh }: { readonly fresh: boolean }): Promise<string> => {
    const resolved = await resolveDid(did as Did, { consistency: fresh ? "fresh" : "cached" });
    if (resolved.signingKeyMultibase === null) throw new IdentityError("invalid_doc");
    return `did:key:${resolved.signingKeyMultibase}`;
  };
  const service = new URL(config.INDEXER_PDS_URL);
  const timeoutMs = config.INDEXER_TIMEOUT_MS;
  const index = createIndexStore(pool, { source: "pds", timeoutMs });
  const tracks = createTrackStore(pool, { timeoutMs });
  const accounts = createAccountStore(pool, { timeoutMs });
  const consumer = indexConsumer(index);
  const watch = streamWatch({
    maxRestartDelayMs: config.INDEXER_MAX_RESTART_DELAY_MS,
    unhealthyAfterMs: config.INDEXER_STREAM_UNHEALTHY_MS,
    now: () => performance.now(),
  });
  const readRepo = createRepoReader({
    service,
    guard,
    signingKey,
    collections: BACKFILL_COLLECTIONS,
    timeoutMs: config.INDEXER_REPO_TIMEOUT_MS,
    maxBytes: config.INDEXER_REPO_MAX_BYTES,
  });
  const readStatus = createRepoStatusReader({ service, guard, timeoutMs });
  const retries: TrackRetries = new Map();
  let lastStop: string | null = null;
  let stops = 0;

  const runner = runIndexer(
    {
      stream: (abort) =>
        readFirehose(
          {
            service,
            signingKey,
            consumer: {
              ...consumer,
              apply: async (frame) => {
                await consumer.apply(frame);
                watch.applied();
              },
            },
            onStop: (reason) => {
              lastStop = reason;
              stops += 1;
              watch.stopped();
              log.warn("indexer.stream_stopped", { reason, count: stops });
            },
            restartDelayMs: config.INDEXER_RESTART_DELAY_MS,
            maxRestartDelayMs: config.INDEXER_MAX_RESTART_DELAY_MS,
          },
          abort,
        ),
      passes: {
        track: (stop) =>
          trackPass({
            store: tracks,
            pdsOf: async (did, abort) => (await resolveDid(did as Did, { consistency: "fresh", signal: abort })).pds,
            ownPds: new URL(config.PDS_PUBLIC_URL),
            timeoutMs,
            retries,
            now: Date.now,
            signal: stop,
          }),
        backfill: (stop) =>
          backfillPass({ store: tracks, readRepo, timeoutMs: config.INDEXER_REPO_TIMEOUT_MS, signal: stop }),
        confirm: (stop) => confirmPass({ store: accounts, readStatus, timeoutMs, signal: stop }),
      },
      intervalMs: config.INDEXER_PASS_INTERVAL_MS,
    },
    signal,
  );
  const health = sharedRead(
    async () => ({
      healthy: watch.healthy(),
      enabled: true,
      stream: { ...consumer.health(), lastStop, stops, failingForMs: watch.failingForMs() },
      loop: runner.health(),
      index: await index.health(),
      accounts: await accounts.health(),
    }),
    HEALTH_CACHE_MS,
  );
  return {
    health,
    done: runner.done.finally(() => pool.end()),
  };
}
