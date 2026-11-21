// What only compose.local.yaml may hold (architecture 2026-10-15 02:32Z, last section of book edit
// 2026-10-13-local-plc-a4-steps): one list that the drift test (compose.local.test.ts) and C17 both read, so CI and
// the preflight agree on it. networks.dev.json gets no local-only rows: a row there would claim the homelab runs it.
import { TOKEN_READER } from "./compose-parse.ts";

/** Services only the local file has: the token reader alone. ADR 0022 retired the local PLC (P1.36w), and P1.29s
 * adds no seed service. */
export const LOCAL_ONLY_SERVICES: ReadonlySet<string> = new Set([TOKEN_READER]);

/**
 * Networks only the local file has, each with its exact members. None today: ADR 0022 retired P1.34v's per-consumer PLC
 * networks, and `plc_*` stays refused outside the local file by isLocalOnlyNetwork (P1.35w).
 */
export const LOCAL_ONLY_NETWORKS: ReadonlyMap<string, { internal: boolean; members: readonly string[] }> = new Map();

/**
 * The other way round (P1.37v; ADR 0030 Decision 2): what only the dev file has, since a local stack has no Pangolin.
 * Newt and its two networks; under local, C17 leaves these rows of networks.dev.json out, and the drift test
 * (compose.local.test.ts) lets the dev file alone hold them.
 */
export const DEV_ONLY_SERVICES: ReadonlySet<string> = new Set(["newt"]);
export const DEV_ONLY_NETWORKS: ReadonlySet<string> = new Set(["newt_edge", "newt_egress"]);

/**
 * Services only the stacks built from the checkout run (local, and dev with --source), with their own networks. Alex,
 * 2026-11-19T00:43Z: "i dont think we should make image it for everything, lets build the next image when we are ready
 * to push something to prod" and "for now deploy from source". So a new service joins compose.local.yaml and
 * compose.dev.source.yaml with a build and no published digest, and stays out of compose.dev.yaml until its image is
 * locked for production. Under dev without --source, C17 leaves these networks' rows out of networks.dev.json and these
 * services out of every row, so the image stack is judged as if they did not exist and fails if it runs one. Every other
 * preflight check judges them as it judges any built service. compose.dev.source.test.ts holds the source file to the
 * dev file plus exactly these.
 */
export const SOURCE_ONLY_SERVICES: ReadonlySet<string> = new Set(["pds-admin", "indexer", "review"]);
export const SOURCE_ONLY_NETWORKS: ReadonlySet<string> = new Set([
  "pds_admin",
  "pds_admin_pds",
  "indexer_pds",
  "indexer_egress",
  "review_web",
]);

/**
 * The chat servers and processes (P6.02 part 4; ADRs 0093, 0098, 0102) and their networks: staging runs them from the
 * checkout only. Local has no chat server until its name is ruled (ADR 0098 Decision 2, so C36 refuses one there),
 * and none of the four has a locked image, so they are in compose.dev.source.yaml alone: neither the image stack nor
 * the local stack may run one. C17 leaves these rows and members out under dev without --source and under local, as
 * it leaves the source-only ones out of the image stack; compose.dev.source.test.ts holds the source file to that.
 */
export const CHAT_SERVICES: ReadonlySet<string> = new Set(["synapse", "mas", "chat-admin", "chat-auth"]);
export const CHAT_NETWORKS: ReadonlySet<string> = new Set([
  "chat_db",
  "chat_synapse_db",
  "chat_mas",
  "chat_admin_mas",
  "chat_count",
  "chat_admin",
  "chat_admin_synapse",
  "chat_edge",
  "chat_edge_synapse",
]);
/** The secrets only the chat services and Postgres's chat-databases.sh read, so only the source file names them. */
export const CHAT_SECRETS: ReadonlySet<string> = new Set([
  "pg_synapse_password",
  "pg_mas_password",
  "synapse_pgpass",
  "synapse_signing_key",
  "synapse_macaroon_secret_key",
  "synapse_form_secret",
  "synapse_mas_secret",
  "mas_pg_password",
  "mas_synapse_secret",
  "mas_chat_admin_client_secret",
  "mas_encryption",
  "mas_signing_key",
  "chat_admin_client_secret",
  "chat_admin_keys",
  "chat_auth_seal_keyring",
  "chat_auth_chat_admin_key",
]);

/** Whether a network belongs to the local stack alone: on the list, or named like the PLC's. */
export const isLocalOnlyNetwork = (name: string): boolean => LOCAL_ONLY_NETWORKS.has(name) || name.startsWith("plc_");

/**
 * Runtime keys only compose.local.yaml may set (P1.36k; architecture 2026-10-19 03:45Z and 03:50Z). A container can't
 * tell a local stack from staging, since both run UNSET_ENV=dev, so each runtime allowance meant for local alone is
 * switched on by a key, and C29 refuses the key under --env dev and prod. Sites: oauth-client.ts (OAUTH_ALLOW_HTTP),
 * shared/config/netGuard.ts (NETGUARD_ALLOW_LOOPBACK).
 */
export const LOCAL_ONLY_KEY_NAMES = ["OAUTH_ALLOW_HTTP", "NETGUARD_ALLOW_LOOPBACK"] as const;
export const LOCAL_ONLY_KEYS: ReadonlySet<string> = new Set(LOCAL_ONLY_KEY_NAMES);
