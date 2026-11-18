// The indexer process's settings (book P3.05s PR 3; ADR 0052 decisions 2 and 7). shared-config like every other
// process, so a bad value exits 78 before anything starts. Indexing is off unless INDEXER_ENABLED says otherwise: off,
// the process serves only its health endpoint and reads nothing.
import { poolFields, postgresFields } from "@unset/infrastructure-postgres";
import { bool, type Config, defineEntrypointConfig, int, netGuardFields, url, withRule } from "@unset/shared-config";

/** What the indexer reads and from where. */
const indexerConfig = {
  INDEXER_ENABLED: bool({ default: false }),
  /**
   * Our PDS's internal origin (the compose service, plain http on 3000 in the dev stack): the stream, getRepo and
   * getRepoStatus go here and nowhere else (ADR 0052 decision 2). Never a URL from the network.
   */
  INDEXER_PDS_URL: url({ protocols: ["http:", "https:"] }),
  /** Our PDS's public origin: a DID is ours when its document names exactly this origin (track.ts). */
  PDS_PUBLIC_URL: url({ protocols: ["https:"] }),
  /** Milliseconds between the end of one round of passes and the start of the next (book P3.06: every 10 s). */
  INDEXER_PASS_INTERVAL_MS: int({ min: 1000, max: 300_000, default: 10_000 }),
  /** The deadline of one network read (a DID document, a repo status) and of one store transaction. */
  INDEXER_TIMEOUT_MS: int({ min: 500, max: 30_000, default: 5000 }),
  /** The deadline of one getRepo read, which downloads the whole repo. */
  INDEXER_REPO_TIMEOUT_MS: int({ min: 1000, max: 120_000, default: 30_000 }),
  /** The largest repo a backfill accepts, in bytes; net-guard allows at most 64 MiB. */
  INDEXER_REPO_MAX_BYTES: int({ min: 1_048_576, max: 67_108_864, default: 33_554_432 }),
  /** The stream reader's wait after a stop, doubling up to the max (reader.ts). */
  INDEXER_RESTART_DELAY_MS: withRule(
    int({ min: 100, max: 60_000, default: 1000 }),
    (config) => Number(config.INDEXER_RESTART_DELAY_MS) <= Number(config.INDEXER_MAX_RESTART_DELAY_MS),
  ),
  INDEXER_MAX_RESTART_DELAY_MS: int({ min: 1000, max: 600_000, default: 60_000 }),
  /** The health endpoint's port, on the process's internal network only. */
  HEALTH_PORT: int({ min: 1024, max: 65535, default: 8081 }),
};

/** The identity lookups the passes and the stream need: the PLC directory, its timeouts and the DID document cache. */
const identityConfig = {
  PLC_URL: url({ protocols: ["https:"] }),
  IDENTITY_HTTP_TIMEOUT_MS: int({ min: 500, max: 10_000, default: 3000 }),
  IDENTITY_DNS_TIMEOUT_MS: int({ min: 500, max: 10_000, default: 2000 }),
  DID_DOC_CACHE_TTL_S: int({ min: 1, max: 3600, default: 300 }),
  DID_DOC_CACHE_MAX: int({ min: 1, max: 100_000, default: 10_000 }),
};

export const schema = defineEntrypointConfig({
  ...postgresFields,
  ...poolFields,
  ...netGuardFields,
  ...identityConfig,
  ...indexerConfig,
});

export type IndexerConfig = Config<(typeof schema)["fields"]>;
