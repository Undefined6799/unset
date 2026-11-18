// pds-admin's configuration (P2.09 Inputs; ADR 0060 decision 1), read once at boot. Any missing or malformed value
// throws a BootError naming the setting, never its value, and main exits 1. Secrets come from files, never env.
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServiceKey } from "./envelope.ts";

export type Config = {
  readonly env: "dev" | "prod";
  readonly pdsDid: string;
  readonly pdsUrl: URL;
  readonly windowHours: number;
  readonly maxPerWindow: number;
  readonly maxPerDayGlobal: number;
  readonly signupsOpen: boolean;
  readonly stateDir: string;
  readonly port: number;
  readonly commit: string;
  readonly password: string;
  readonly logKey: Buffer;
  readonly keys: readonly ServiceKey[];
};

export class BootError extends Error {}

const DID = /^did:(plc|web):[A-Za-z0-9._:%-]{1,256}$/;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new BootError(`${name} is not set`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[0-9]{1,6}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new BootError(`${name} is out of range`);
  return Number(raw);
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

/** The key file: one entry per key, issuer `web`, an Ed25519 public key, and only the verb `invite.issue`. */
function serviceKeys(text: string): ServiceKey[] {
  const bad = new BootError("secret pds_admin_keys.json is malformed");
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    throw bad;
  }
  if (!Array.isArray(entries) || entries.length !== 1) throw bad;
  return entries.map((entry: Record<string, unknown>) => {
    const { kid, iss, publicKeyPem, verbs } = entry;
    if (typeof kid !== "string" || kid === "" || kid.length > 64 || iss !== "web" || typeof publicKeyPem !== "string") {
      throw bad;
    }
    if (!Array.isArray(verbs) || verbs.length !== 1 || verbs[0] !== "invite.issue") throw bad;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw bad;
    return { kid, iss, key, verbs: ["invite.issue"] };
  });
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const mode = required(env, "PDS_ADMIN_ENV");
  if (mode !== "dev" && mode !== "prod") throw new BootError("PDS_ADMIN_ENV must be dev or prod");
  const pdsDid = required(env, "PDS_DID");
  if (!DID.test(pdsDid)) throw new BootError("PDS_DID is not a DID");
  const rawUrl = required(env, "PDS_INTERNAL_URL");
  if (!URL.canParse(rawUrl) || new URL(rawUrl).protocol !== "http:" || new URL(rawUrl).origin !== rawUrl) {
    throw new BootError("PDS_INTERNAL_URL must be an http origin");
  }
  const signups = required(env, "SIGNUPS_OPEN");
  if (signups !== "true" && signups !== "false") throw new BootError("SIGNUPS_OPEN must be true or false");
  const secrets = env.PDS_ADMIN_SECRETS_DIR ?? "/run/secrets";
  const logKey = Buffer.from(secret(secrets, "pds_admin_log_key"), "base64");
  if (logKey.length !== 32) throw new BootError("secret pds_admin_log_key is not 32 bytes of base64");
  return {
    env: mode,
    pdsDid,
    pdsUrl: new URL(rawUrl),
    windowHours: integer(env, "INVITE_WINDOW_HOURS", 24, 24 * 30),
    maxPerWindow: integer(env, "INVITE_MAX_PER_WINDOW", 5, 1000),
    maxPerDayGlobal: integer(env, "INVITE_MAX_PER_DAY_GLOBAL", 100, 100_000),
    signupsOpen: signups === "true",
    stateDir: required(env, "STATE_DIR"),
    port: integer(env, "PORT", 8080, 65_535),
    commit: env.COMMIT ?? "unknown",
    password: secret(secrets, "pds_admin_password"),
    logKey,
    keys: serviceKeys(secret(secrets, "pds_admin_keys.json")),
  };
}
