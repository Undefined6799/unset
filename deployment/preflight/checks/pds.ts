// C6, C7, C8, C11 and C12 (P1.30; plan section 5.2, 5.3): the PDS's own settings that would leak data or cannot be
// fixed later. Values are read only through the SecretMap; a reason names the variable, never its value.
import type { SecretMap } from "../secret-map.ts";
import { type Check, fail, type Inputs, type Outcome, pass } from "./types.ts";

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
    if (!equals(env, "PDS_INVITE_REQUIRED", "true")) return fail("PDS_INVITE_REQUIRED is not true");
    if (stage === "dev" && !equals(env, "PDS_CRAWLERS", "")) return fail("PDS_CRAWLERS is not set empty in dev");
    if (!env.use("PDS_ADMIN_PASSWORD", (v) => (v ?? "").length >= 32)) {
      return fail("PDS_ADMIN_PASSWORD is shorter than 32 characters");
    }
    // The PDS sees only the edge's address, so its per-IP limit would be one bucket for everyone; unset fails too.
    if (!equals(env, "PDS_RATE_LIMITS_ENABLED", "false")) return fail("PDS_RATE_LIMITS_ENABLED is not exactly false");
    return pass();
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

/** C11: mail leaves over TLS, never through Mailpit in prod. Nodemailer reads the URL's query as transport options
 * (nodemailer 10.0.15 shared/index.js parseConnectionUrl), so `requireTLS=true` makes STARTTLS mandatory. */
export function smtpProblem(raw: string | undefined, stage: "dev" | "prod", name: string): string | null {
  if (raw === undefined) return `${name} missing`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${name} is not a URL`;
  }
  if (url.hostname === "mailpit") return stage === "dev" ? null : `${name} is Mailpit in prod`;
  if (url.searchParams.has("ignoreTLS") || url.searchParams.has("tls.rejectUnauthorized")) {
    return `${name} weakens TLS`;
  }
  if (url.protocol === "smtps:") return null;
  const requireTls = url.searchParams.getAll("requireTLS");
  if (url.protocol === "smtp:" && requireTls.length === 1 && requireTls[0] === "true") return null;
  return `${name} is neither smtps nor smtp with requireTLS=true`;
}

export const c11: Check = {
  id: "C11",
  run: withPds((env, { env: stage }) => {
    const problem = env.use("PDS_EMAIL_SMTP_URL", (v) => smtpProblem(v, stage, "PDS_EMAIL_SMTP_URL"));
    return problem === null ? pass() : fail(problem);
  }),
};

/** C12: PDS request logging off; when on it logs client addresses and every request header (runbook
 * docs/human/runbooks/pds-debug-logging.md is the only way to turn it on). */
export const c12: Check = {
  id: "C12",
  run: withPds((env) =>
    !env.has("LOG_ENABLED") || equals(env, "LOG_ENABLED", "false")
      ? pass()
      : fail("LOG_ENABLED is on; see docs/human/runbooks/pds-debug-logging.md"),
  ),
};
