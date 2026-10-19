// C6, C7, C8, C11 and C12 (P1.30; plan section 5.2, 5.3): the PDS's own settings that would leak data or cannot be
// fixed later. Values are read only through the SecretMap; a reason names the variable, never its value.
import type { SecretMap } from "../secret-map.ts";
import { type Check, type Env, fail, type Inputs, type Outcome, pass } from "./types.ts";

/** The PDS service's environment; a stack without a `pds` service fails every PDS check. */
function pdsEnv(inputs: Inputs): SecretMap | null {
  return inputs.serviceEnv.get("pds") ?? null;
}
export function withPds(run: (env: SecretMap, inputs: Inputs) => Outcome): Check["run"] {
  return (inputs) => {
    const env = pdsEnv(inputs);
    return env === null ? fail("no pds service") : run(env, inputs);
  };
}
const equals = (env: SecretMap, name: string, expected: string): boolean => env.use(name, (v) => v === expected);

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58btc (multibase `z`) to bytes, or null for a character outside the alphabet. */
function base58(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * A did:key for a compressed secp256k1 or P-256 public key: multicodec varint [0xE7, 0x01] or [0x80, 0x24], then 33
 * bytes starting 0x02 or 0x03 (https://atproto.com/specs/cryptography, "Public Key Encoding").
 */
export function isAtprotoDidKey(value: string): boolean {
  if (!value.startsWith("did:key:z")) return false;
  const bytes = base58(value.slice("did:key:z".length));
  if (bytes === null || bytes.length !== 35) return false;
  const codec = (bytes[0] === 0xe7 && bytes[1] === 0x01) || (bytes[0] === 0x80 && bytes[1] === 0x24);
  return codec && (bytes[2] === 0x02 || bytes[2] === 0x03);
}

/** C6: the recovery key, which cannot be added to existing DID documents later. */
export const c6: Check = {
  id: "C6",
  run: withPds((env) => {
    if (!env.has("PDS_RECOVERY_DID_KEY")) {
      return fail("PDS_RECOVERY_DID_KEY missing; it cannot be added to existing accounts' DID documents later");
    }
    return env.use("PDS_RECOVERY_DID_KEY", (v) => isAtprotoDidKey(v ?? ""))
      ? pass()
      : fail("PDS_RECOVERY_DID_KEY is not a secp256k1 or P-256 did:key");
  }),
};

/** C7: invites required, no crawling in dev, a long admin password, and the PDS's per-IP limits off explicitly. */
export const c7: Check = {
  id: "C7",
  run: withPds((env, { env: stage }) => {
    if (!equals(env, "PDS_INVITE_REQUIRED", "true")) return fail("PDS_INVITE_REQUIRED does not require invites");
    // A local stack is a dev stack on one machine: it never asks the network to crawl it either (P1.27l).
    if (stage !== "prod" && !equals(env, "PDS_CRAWLERS", "")) return fail("PDS_CRAWLERS is not set empty in dev");
    if (!env.use("PDS_ADMIN_PASSWORD", (v) => (v ?? "").length >= 32)) {
      return fail("PDS_ADMIN_PASSWORD is shorter than 32 characters");
    }
    // The PDS sees only the edge's address, so its per-IP limit would be one bucket for everyone; unset fails too.
    if (!equals(env, "PDS_RATE_LIMITS_ENABLED", "false"))
      return fail("PDS_RATE_LIMITS_ENABLED does not turn the PDS's own limits off");
    return pass();
  }),
};

/**
 * The PLC directory every env's PDS publishes to (P1.34t; ADRs 0022 and 0023): the shared public directory, exactly.
 * We run no PLC of our own (Alex, 2026-10-16), so the local PDS's test accounts are public did:plc entries too; they are a few
 * fixed accounts made once, and no seed or probe creates more (the token reader refuses this stack).
 */
const PLC_URL = "https://plc.directory";

/**
 * C28: PDS_DID_PLC_URL is set and is exactly the public PLC in every env. Unset or empty, the PDS also uses
 * https://plc.directory (@atproto/pds 0.5.37 dist/config/config.js:99), but the value is required spelled out, so each
 * file states where its accounts are published and a look-alike never passes.
 */
export const c28: Check = {
  id: "C28",
  run: withPds((env) => {
    if (!env.has("PDS_DID_PLC_URL")) return fail("PDS_DID_PLC_URL missing");
    if (equals(env, "PDS_DID_PLC_URL", PLC_URL)) return pass();
    return fail("PDS_DID_PLC_URL is not the public PLC");
  }),
};

/** C8: no rate-limit bypass key or address in any service's environment, even empty. */
export const c8: Check = {
  id: "C8",
  run: ({ serviceEnv }) => {
    for (const [service, env] of serviceEnv) {
      const name = env.names().find((n) => n.startsWith("PDS_RATE_LIMIT_BYPASS_"));
      if (name !== undefined) return fail(`${name} is set in ${service}`);
    }
    return pass();
  },
};

/** C11: mail leaves over TLS, never through Mailpit. Nodemailer reads the URL's query as transport options
 * (nodemailer 10.0.15 shared/index.js parseConnectionUrl), so `requireTLS=true` makes STARTTLS mandatory. */
// No dev service runs Mailpit, so dev refuses it too (P1.36g). A local stack sends no mail at all (Alex's "Local only"
// card, 2026-10-14T20:28:12Z; record 2026-10-13-p127l-local-gaps, Amendment 6), so localMail below refuses any SMTP
// key there instead.
export function smtpProblem(raw: string | undefined, stage: Env, name: string): string | null {
  if (raw === undefined) return `${name} missing`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${name} is not a URL`;
  }
  if (url.hostname === "mailpit") return `${name} is Mailpit`;
  if (url.searchParams.has("ignoreTLS") || url.searchParams.has("tls.rejectUnauthorized")) {
    return `${name} weakens TLS`;
  }
  if (url.protocol === "smtps:") return null;
  const requireTls = url.searchParams.getAll("requireTLS");
  if (url.protocol === "smtp:" && requireTls.length === 1 && requireTls[0] === "true") return null;
  return `${name} is neither smtps nor smtp with requireTLS=true`;
}

/** Under --env local: every mail key must be absent, even empty, so the local stack can never half-configure mail. */
export function localMail(env: SecretMap, ...names: string[]): Outcome {
  const name = names.find((n) => env.has(n));
  return name === undefined
    ? pass("skipped: local runs without email")
    : fail(`${name} is set; local runs without email`);
}

/**
 * An RFC 5322 addr-spec in dot-atom form only (section 3.4.1, atext from 3.2.3), with a dotted domain of LDH labels: no
 * display name, quoted local part, domain literal or list. Stricter than the RFC, which a from address needs no more of.
 */
const ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
/** A DNS label of at most 63 characters (RFC 1035 section 2.3.4). */
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
/** RFC 5321 section 4.5.3.1.3: a path holds at most 256 octets, so an address at most 254. */
const MAX_ADDRESS = 254;
const ADDR_SPEC = new RegExp(`^${ATOM}(?:\\.${ATOM})*@${LABEL}(?:\\.${LABEL})+$`);

/** Why a from address is not usable, naming the key only, or null. */
export function fromAddressProblem(raw: string | undefined, name: string): string | null {
  if (raw === undefined || raw === "") return `${name} missing`;
  return raw.length <= MAX_ADDRESS && ADDR_SPEC.test(raw) ? null : `${name} is not an email address`;
}

export const c11: Check = {
  id: "C11",
  run: withPds((env, { env: stage }) => {
    if (stage === "local") return localMail(env, "PDS_EMAIL_SMTP_URL", "PDS_EMAIL_FROM_ADDRESS");
    const problem =
      env.use("PDS_EMAIL_SMTP_URL", (v) => smtpProblem(v, stage, "PDS_EMAIL_SMTP_URL")) ??
      env.use("PDS_EMAIL_FROM_ADDRESS", (v) => fromAddressProblem(v, "PDS_EMAIL_FROM_ADDRESS"));
    return problem === null ? pass() : fail(problem);
  }),
};

/** Pino levels at info or above, and silent; debug and trace log personal data beyond request headers. */
const LOG_LEVELS = new Set(["info", "warn", "error", "fatal", "silent"]);

/** C12: PDS request logging off; when on it logs client addresses and every request header (runbook
 * docs/human/runbooks/pds-debug-logging.md is the only way to turn it on). LOG_LEVEL stays at info or above. */
export const c12: Check = {
  id: "C12",
  run: withPds((env) => {
    if (env.has("LOG_ENABLED") && !equals(env, "LOG_ENABLED", "false")) {
      return fail("LOG_ENABLED differs from the required literal; see docs/human/runbooks/pds-debug-logging.md");
    }
    if (env.has("LOG_LEVEL") && !env.use("LOG_LEVEL", (v) => LOG_LEVELS.has(v ?? ""))) {
      return fail("LOG_LEVEL is not one of the allowed levels");
    }
    return pass();
  }),
};

/** What pds.env holds (P1.36q): the PDS's secrets, plus both mail URLs where mail is sent (dev and prod). */
const PDS_ENV_SECRETS = [
  "PDS_JWT_SECRET",
  "PDS_ADMIN_PASSWORD",
  "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX",
  "PDS_RECOVERY_DID_KEY",
];
const PDS_ENV_MAIL = ["PDS_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_SMTP_URL"];
/** A name C30 may print: one of ours. Anything else in a key slot might be a pasted value, so it is not named. */
const PRINTABLE = /^PDS_[A-Z0-9_]+$/;

/**
 * C30: the PDS's env file holds exactly its set of names (P1.36q), so no unreviewed setting or stray secret rides in
 * beside the secrets; every other setting is a compose literal. One env per host: four names under local, which sends
 * no mail, and six under dev and prod. Names only; a value is never read.
 */
export const c30: Check = {
  id: "C30",
  run: ({ env: stage, envFileNames, compose }) => {
    const names = envFileNames.get("pds");
    if (names === undefined) return fail("no pds service");
    // Compose's environment wins over env_file, so a name of the set written there would shadow pds.env's value.
    const inCompose = compose.services
      .find((s) => s.name === "pds")
      ?.environment.find(([name]) => [...PDS_ENV_SECRETS, ...PDS_ENV_MAIL].includes(name));
    if (inCompose !== undefined) return fail(`${inCompose[0]} is set in the pds service's environment, not pds.env`);
    const expected = stage === "local" ? PDS_ENV_SECRETS : [...PDS_ENV_SECRETS, ...PDS_ENV_MAIL];
    const label = (name: string) => (PRINTABLE.test(name) ? name : "a name");
    const repeated = names.find((name, i) => names.indexOf(name) !== i);
    if (repeated !== undefined) return fail(`${label(repeated)} is repeated in the pds env file`);
    const extra = names.find((name) => !expected.includes(name));
    if (extra !== undefined)
      return fail(`${label(extra)} is in the pds env file, which under ${stage} holds only its set`);
    const missing = expected.find((name) => !names.includes(name));
    return missing === undefined ? pass() : fail(`${missing} is missing from the pds env file`);
  },
};
