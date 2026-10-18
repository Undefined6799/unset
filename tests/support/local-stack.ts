// P1.29t: judgements the running-local-stack tests share. Docker, TLS and the PDS are unmanaged, so callers inject
// inspect JSON, lookup answers and GET results (TE-1). Nothing here creates an account, calls the email-token reader,
// or names a password, DID or mailbox (ADR 0023, ADR 0026). Reasons are fixed codes, never a host, IP or handle (SE-7).
//
// client_id is the OAuth client metadata document (https://atproto.com/specs/oauth, "Client ID Metadata Document").
// The live GET from inside the PDS container is P1.33z (book edit 2026-10-14-p134d-split, probe-departure): session
// containers cannot pull the PDS image. This module still refuses every env other than local, so a later live probe
// cannot run under dev (architecture Amendment 4 of 2026-10-13-local-plc, point 1, and Amendment 6, S3).
export const PROJECT = "unset-local";
export const EDGE_NETWORK = "edge";
export const PDS_UID = 1000;
export const CLIENT_ID_PATH = "/oauth-client-metadata.json";
export const LOCAL_HANDLES = ["alice.unset.im", "bob.unset.im"] as const;
export type LocalHandle = (typeof LOCAL_HANDLES)[number];

export type ProbeReason =
  | "probe.not_local"
  | "probe.edge_address_missing"
  | "probe.handle_not_local_test_account"
  | "probe.client_id_not_metadata"
  | "probe.host_not_edge"
  | "pds.device_row_has_client_ip"
  | "pds.not_uid_1000"
  | "pds.volume_not_owned_by_1000"
  | "pds.volume_not_writable";

export type TlsGet = {
  host: string;
  path: string;
  address: string;
  ca: string;
  rejectUnauthorized: true;
};

type Networks = Record<string, { IPAddress?: unknown } | undefined>;
type Inspect = { NetworkSettings?: { Networks?: Networks } };

export const composeNetworkName = (project: string, network: string): string => `${project}_${network}`;

/** The edge's address on `network`, read from `docker inspect` JSON, never a fixed IP (P1.29a: no ipam). */
export function edgeAddressFromInspect(
  inspect: unknown,
  project = PROJECT,
  network = EDGE_NETWORK,
): string | { reason: "probe.edge_address_missing" } {
  if (typeof inspect !== "object" || inspect === null) return { reason: "probe.edge_address_missing" };
  const row = (inspect as Inspect).NetworkSettings?.Networks?.[composeNetworkName(project, network)];
  const ip = row?.IPAddress;
  if (typeof ip !== "string" || ip === "") return { reason: "probe.edge_address_missing" };
  return ip;
}

export function probeEnv(env: string | undefined): "ok" | "probe.not_local" {
  return env === "local" ? "ok" : "probe.not_local";
}

export function isLocalHandle(handle: string): handle is LocalHandle {
  return (LOCAL_HANDLES as readonly string[]).includes(handle);
}

/**
 * First assertion of P1.29t: an HTTPS GET of web's client_id, connected to the edge's inspect address, verified
 * against the dev root only. No fetch until env is local and the edge address exists.
 */
export function clientIdProbePlan(input: {
  env: string | undefined;
  inspect: unknown;
  appHost: string;
  ca: string;
}): { ok: true; get: TlsGet } | { ok: false; reason: "probe.not_local" | "probe.edge_address_missing" } {
  if (probeEnv(input.env) !== "ok") return { ok: false, reason: "probe.not_local" };
  const address = edgeAddressFromInspect(input.inspect);
  if (typeof address !== "string") return { ok: false, reason: address.reason };
  return {
    ok: true,
    get: { host: input.appHost, path: CLIENT_ID_PATH, address, ca: input.ca, rejectUnauthorized: true },
  };
}

export function clientMetadataProblem(body: unknown, clientId: string): "probe.client_id_not_metadata" | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "probe.client_id_not_metadata";
  return (body as { client_id?: unknown }).client_id === clientId ? null : "probe.client_id_not_metadata";
}

/** APP_HOST and PDS_HOST, looked up from inside the PDS, must be exactly the edge's inspect address. */
export function hostResolvesToEdge(
  answers: readonly string[],
  edgeIp: string,
): "ok" | "probe.host_not_edge" | "probe.edge_address_missing" {
  if (edgeIp === "") return "probe.edge_address_missing";
  return answers.length === 1 && answers[0] === edgeIp ? "ok" : "probe.host_not_edge";
}

/**
 * After a real PDS login as Alice or Bob (this step does not create the account), the device row's ipAddress is the
 * edge's address on `edge`, never the client's (P1b-A1: the edge forwards no client address).
 */
export function deviceRowVerdict(input: {
  env: string | undefined;
  handle: string;
  deviceIp: string;
  inspect: unknown;
}): { ok: true } | { ok: false; reason: ProbeReason } {
  if (probeEnv(input.env) !== "ok") return { ok: false, reason: "probe.not_local" };
  if (!isLocalHandle(input.handle)) return { ok: false, reason: "probe.handle_not_local_test_account" };
  const edgeIp = edgeAddressFromInspect(input.inspect);
  if (typeof edgeIp !== "string") return { ok: false, reason: edgeIp.reason };
  return input.deviceIp === edgeIp ? { ok: true } : { ok: false, reason: "pds.device_row_has_client_ip" };
}

/** P1.29a: `id -u` is 1000, the data directory is owned by 1000, and a write succeeds. */
export function pdsVolumeVerdict(input: {
  uid: number;
  ownerUid: number;
  writeOk: boolean;
}): "ok" | "pds.not_uid_1000" | "pds.volume_not_owned_by_1000" | "pds.volume_not_writable" {
  if (input.uid !== PDS_UID) return "pds.not_uid_1000";
  if (input.ownerUid !== PDS_UID) return "pds.volume_not_owned_by_1000";
  return input.writeOk ? "ok" : "pds.volume_not_writable";
}

/** local:up never seeds, never createAccount, never writes a seed file, never runs the token reader (ADR 0023). */
export function argvCreatesAccount(argv: readonly string[]): boolean {
  return argv.some((part) => /dev-seed|createAccount|\.seeded\.json|pds-token-reader/.test(part));
}
