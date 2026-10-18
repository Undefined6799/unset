// What only compose.local.yaml may hold (architecture 2026-10-15 02:32Z, last section of book edit
// 2026-10-13-local-plc-a4-steps): one list that the drift test (compose.local.test.ts) and C17 both read, so CI and
// the preflight agree on it. networks.dev.json gets no local-only rows: a row there would claim the homelab runs it.
import { TOKEN_READER } from "./compose-parse.ts";

/** Services only the local file has: the token reader now. `plc` is the retired local-PLC placeholder (ADR 0022).
 * P1.29s adds no seed service. */
export const LOCAL_ONLY_SERVICES: ReadonlySet<string> = new Set([TOKEN_READER, "plc"]);

/**
 * Networks only the local file has, each with its exact members. P1.34v adds the PLC's per-consumer networks here
 * (plc_pds, plc_web, plc_appview), each holding the PLC and that one consumer (architecture 02:26Z).
 */
export const LOCAL_ONLY_NETWORKS: ReadonlyMap<string, { internal: boolean; members: readonly string[] }> = new Map();

/** Whether a network belongs to the local stack alone: on the list, or named like the PLC's. */
export const isLocalOnlyNetwork = (name: string): boolean => LOCAL_ONLY_NETWORKS.has(name) || name.startsWith("plc_");
