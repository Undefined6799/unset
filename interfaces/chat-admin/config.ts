// chat-admin's configuration (ADR 0093 decision 5), read once at boot. A missing or malformed value throws a BootError
// naming the setting, never its value. Secrets come from files, never env.
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatAdminVerb } from "@unset/shared-admin-envelope";
import { ISSUER_VERBS, type Issuer, type ServiceKey } from "./envelope.ts";

export type Config = {
  readonly env: "dev" | "prod";
  readonly adminUrl: URL;
  readonly tokenUrl: URL;
  /** Synapse's client listener on the network only Synapse and chat-admin join, for the room sweep (ADR 0102). */
  readonly synapseUrl: URL;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Seconds each minted token lives; always sent, as MAS mints a token that never expires without it (spec.json,
   * CreatePersonalSessionRequest.expires_in, MAS 1.26.0). */
  readonly sessionTtl: number;
  readonly stateDir: string;
  readonly port: number;
  /** The one address its listener binds: its own on the network web and the door share with it. */
  readonly listenAddress: string;
  readonly commit: string;
  readonly keys: readonly ServiceKey[];
};

export class BootError extends Error {}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** A dotted-quad IPv4 address with no leading zeros (kept here: chat-admin imports nothing outside its folder). */
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** One IPv4 address, never 0.0.0.0, which would bind every network chat-admin joins (Node 26 net.Server.listen). */
function listenAddress(env: NodeJS.ProcessEnv): string {
  const raw = required(env, "LISTEN_ADDRESS");
  if (!IPV4.test(raw) || raw === "0.0.0.0") throw new BootError("LISTEN_ADDRESS must be one IPv4 address");
  return raw;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new BootError(`${name} is not set`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[0-9]{1,7}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new BootError(`${name} is out of range`);
  return Number(raw);
}

/** An internal http origin and nothing more (the edge never routes to MAS or this listener; ADR 0093 decision 6,
 * ADR 0102 decision 8). */
function origin(env: NodeJS.ProcessEnv, name: string): URL {
  const raw = required(env, name);
  if (!URL.canParse(raw) || new URL(raw).protocol !== "http:" || new URL(raw).origin !== raw) {
    throw new BootError(`${name} must be an http origin`);
  }
  return new URL(raw);
}

function secret(dir: string, name: string): string {
  let text: string;
  try {
    text = readFileSync(join(dir, name), "utf8").trim();
  } catch {
    throw new BootError(`secret ${name} cannot be read`);
  }
  if (text === "") throw new BootError(`secret ${name} is empty`);
  return text;
}

/** The key file: per key a kid, an issuer, an Ed25519 public key and verbs inside what that issuer may ask. */
function serviceKeys(text: string): ServiceKey[] {
  const bad = new BootError("secret chat_admin_keys is malformed");
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    throw bad;
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 4) throw bad;
  return entries.map((entry: Record<string, unknown>) => {
    const { kid, iss, publicKeyPem, verbs } = entry;
    if (typeof kid !== "string" || kid === "" || kid.length > 64 || typeof publicKeyPem !== "string") throw bad;
    if (iss !== "web" && iss !== "door") throw bad;
    const allowed: readonly string[] = ISSUER_VERBS[iss as Issuer];
    if (!Array.isArray(verbs) || verbs.length === 0 || !verbs.every((v) => allowed.includes(v))) throw bad;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw bad;
    return { kid, iss, key, verbs: verbs as ChatAdminVerb[] };
  });
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const mode = required(env, "CHAT_ADMIN_ENV");
  if (mode !== "dev" && mode !== "prod") throw new BootError("CHAT_ADMIN_ENV must be dev or prod");
  const clientId = required(env, "MAS_CLIENT_ID");
  if (!ULID.test(clientId)) throw new BootError("MAS_CLIENT_ID is not a ULID");
  const secrets = env.CHAT_ADMIN_SECRETS_DIR ?? "/run/secrets";
  return {
    env: mode,
    adminUrl: origin(env, "MAS_ADMIN_URL"),
    tokenUrl: origin(env, "MAS_TOKEN_URL"),
    synapseUrl: origin(env, "SYNAPSE_ADMIN_URL"),
    clientId,
    clientSecret: secret(secrets, "chat_admin_client_secret"),
    sessionTtl: integer(env, "SESSION_TTL_SECONDS", 86_400, 30 * 86_400),
    stateDir: required(env, "STATE_DIR"),
    port: integer(env, "PORT", 8080, 65_535),
    listenAddress: listenAddress(env),
    commit: env.COMMIT ?? "unknown",
    keys: serviceKeys(secret(secrets, "chat_admin_keys")),
  };
}
