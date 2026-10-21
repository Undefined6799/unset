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

/** Whether a network belongs to the local stack alone: on the list, or named like the PLC's. */
export const isLocalOnlyNetwork = (name: string): boolean => LOCAL_ONLY_NETWORKS.has(name) || name.startsWith("plc_");

/**
 * Runtime keys only compose.local.yaml may set (P1.36k; architecture 2026-10-19 03:45Z and 03:50Z). A container can't
 * tell a local stack from staging, since both run UNSET_ENV=dev, so each runtime allowance meant for local alone is
 * switched on by a key, and C29 refuses the key under --env dev and prod. Sites: oauth-client.ts (OAUTH_ALLOW_HTTP),
 * shared/config/netGuard.ts (NETGUARD_ALLOW_LOOPBACK), shared/http/config.ts and csp/headers.ts (DEV_VITE_ORIGIN).
 */
export const LOCAL_ONLY_KEY_NAMES = ["OAUTH_ALLOW_HTTP", "NETGUARD_ALLOW_LOOPBACK", "DEV_VITE_ORIGIN"] as const;
export const LOCAL_ONLY_KEYS: ReadonlySet<string> = new Set(LOCAL_ONLY_KEY_NAMES);
