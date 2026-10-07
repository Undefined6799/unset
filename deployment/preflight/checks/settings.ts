// C13 to C16, C19, C20, C22 and C23 (P1.30s; plan section 5.2, 5.3): further settings that would leak data, redirect
// trust or silently drop mail. Names and parsing follow @atproto/pds 0.5.37 packages/pds/src/config/env.ts and
// packages/common/src/env.ts: envStr treats an empty value as unset, envList splits on commas, envInt parses an
// integer. A reason names the variable, never its value.
import type { SecretMap } from "../secret-map.ts";
import { smtpProblem, withPds } from "./pds.ts";
import { type Check, fail, type Inputs, pass } from "./types.ts";

const present = (env: SecretMap, name: string): boolean => env.has(name);
const value = (env: SecretMap, name: string): string | undefined => env.use(name, (v) => v);
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

/** C13: no lexicon authority override, which redirects resolution of every NSID to one DID. */
export const c13: Check = {
  id: "C13",
  run: withPds((env) =>
    present(env, "PDS_LEXICON_AUTHORITY_DID") ? fail("PDS_LEXICON_AUTHORITY_DID is set") : pass(),
  ),
};

/** C14: the PDS is not in dev mode. */
export const c14: Check = {
  id: "C14",
  run: withPds((env) =>
    !present(env, "PDS_DEV_MODE") || value(env, "PDS_DEV_MODE") === "false"
      ? pass()
      : fail("PDS_DEV_MODE is not absent or false"),
  ),
};

/** C15: handle domains set explicitly, `.0x40.space` in dev, and never the retired `.0x40.me`. */
export const c15: Check = {
  id: "C15",
  run: withPds((env, { env: stage }) => {
    const domains = (value(env, "PDS_SERVICE_HANDLE_DOMAINS") ?? "").split(",").filter((d) => d !== "");
    if (domains.length === 0) return fail("PDS_SERVICE_HANDLE_DOMAINS is not set");
    if (domains.some((d) => d === ".0x40.me" || d.endsWith(".0x40.me"))) {
      return fail("PDS_SERVICE_HANDLE_DOMAINS contains .0x40.me");
    }
    if (stage === "dev" && !(domains.length === 1 && domains[0] === ".0x40.space")) {
      return fail("PDS_SERVICE_HANDLE_DOMAINS is not .0x40.space in dev");
    }
    return pass();
  }),
};

/** C16: no confirmation link in mail (plan section 5.3: "the deploy preflight fails otherwise"). */
export const c16: Check = {
  id: "C16",
  run: withPds((env) =>
    value(env, "PDS_EMAIL_DISABLE_CONFIRMATION_LINK") === "true"
      ? pass()
      : fail("PDS_EMAIL_DISABLE_CONFIRMATION_LINK is not true"),
  ),
};

/** C19: moderation mail configured, under C11's TLS rule; without it the PDS drops every moderation receipt. */
export const c19: Check = {
  id: "C19",
  run: withPds((env, { env: stage }) => {
    const problem = env.use("PDS_MODERATION_EMAIL_SMTP_URL", (v) =>
      smtpProblem(v, stage, "PDS_MODERATION_EMAIL_SMTP_URL"),
    );
    if (problem !== null) return fail(problem);
    return (value(env, "PDS_MODERATION_EMAIL_ADDRESS") ?? "") === ""
      ? fail("PDS_MODERATION_EMAIL_ADDRESS missing")
      : pass();
  }),
};

/** C20: no moderation service override; only the report service may be set, from Phase 5. */
export const c20: Check = {
  id: "C20",
  run: withPds((env) => {
    const name = env.names().find((n) => n.startsWith("PDS_MOD_SERVICE_"));
    return name === undefined ? pass() : fail(`${name} is set`);
  }),
};

/** The largest VIDEO_MASTER_MAX_BYTES any service sets, null when none does, or "invalid". */
function videoMasterMax({ serviceEnv }: Inputs): bigint | null | "invalid" {
  let max: bigint | null = null;
  for (const env of serviceEnv.values()) {
    if (!present(env, "VIDEO_MASTER_MAX_BYTES")) continue;
    const raw = value(env, "VIDEO_MASTER_MAX_BYTES") ?? "";
    if (!NON_NEGATIVE_INTEGER.test(raw)) return "invalid";
    max = max === null || BigInt(raw) > max ? BigInt(raw) : max;
  }
  return max;
}

/** C22: from Phase 4, the PDS accepts a blob as large as the largest video master (its default is 5 MB). */
export const c22: Check = {
  id: "C22",
  run: withPds((env, inputs) => {
    const master = videoMasterMax(inputs);
    if (master === null) return pass("n/a");
    if (master === "invalid") return fail("VIDEO_MASTER_MAX_BYTES is not an integer");
    const limit = value(env, "PDS_BLOB_UPLOAD_LIMIT") ?? "";
    if (!NON_NEGATIVE_INTEGER.test(limit)) return fail("PDS_BLOB_UPLOAD_LIMIT is not set to an integer");
    return BigInt(limit) >= master ? pass() : fail("PDS_BLOB_UPLOAD_LIMIT is below VIDEO_MASTER_MAX_BYTES");
  }),
};

/** C23: prod scans uploads against Arachnid and never a fake list (P5.07b; the server's boot refusal is the second
 * guard). Dev skips it. */
export const c23: Check = {
  id: "C23",
  run: ({ env: stage, serviceEnv }) => {
    if (stage !== "prod") return pass("n/a");
    let checked = false;
    for (const [service, env] of serviceEnv) {
      if (present(env, "FAKE_FINGERPRINT_LIST")) return fail(`FAKE_FINGERPRINT_LIST is set in ${service}`);
      if (!present(env, "FINGERPRINT_CHECK")) continue;
      if (value(env, "FINGERPRINT_CHECK") !== "arachnid")
        return fail(`FINGERPRINT_CHECK is not arachnid in ${service}`);
      checked = true;
    }
    return checked ? pass() : fail("no service sets FINGERPRINT_CHECK=arachnid");
  },
};
