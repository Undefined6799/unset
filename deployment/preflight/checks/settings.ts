// C13 to C16, C19, C20, C22 and C23 (P1.30s; plan section 5.2, 5.3): further settings that would leak data, redirect
// trust or silently drop mail. Names and parsing follow @atproto/pds 0.5.37 packages/pds/src/config/env.ts and
// packages/common/src/env.ts: envStr treats an empty value as unset, envList splits on commas, envInt parses an
// integer. A reason names the variable, never its value.
import type { SecretMap } from "../secret-map.ts";
import { localMail, smtpProblem, withPds } from "./pds.ts";
import { type Check, fail, type Inputs, pass, serviceNamed } from "./types.ts";

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

/**
 * A setting that turns a PDS protection off or enables dev mode (P1.34k). The one exemption is the confirmation-link
 * switch, and only at the exact value `true` (C16 requires that pair). The key's presence is the denial: @atproto/pds
 * (packages/pds/src/config/env.ts on main, read 2026-10-14) parses these with envBool, which treats `true` and `1` as
 * true and `false` and `0` as false (packages/common/src/env.ts). A value PDS currently ignores must not be allowed
 * through, because the compose rule already refuses the key itself. The shipped image is pds 0.4.5037; that tag's
 * env.ts URL was not published, so this reading is the repository main, not that tag.
 */
export function switchesProtectionOff(name: string, value: string): boolean {
  if (name === "PDS_EMAIL_DISABLE_CONFIRMATION_LINK" && value === "true") return false;
  return name.includes("DEV_MODE") || (name.startsWith("PDS_") && name.includes("DISABLE"));
}

/** C14: no dev mode and no PDS switch that turns a protection off. The reason names the key, never its value. */
export const c14: Check = {
  id: "C14",
  run: withPds((env) => {
    for (const name of env.names()) {
      const off = env.use(name, (raw) => (raw === undefined ? false : switchesProtectionOff(name, raw)));
      if (off) return fail(`${name} turns a protection off`);
    }
    return pass();
  }),
};

/**
 * C15: handle domains set explicitly, `.0x40.space` in dev, and never the retired `.0x40.me`. Under --env local every
 * domain sits under the PDS's own `.localhost` host, the one name the dev root permits a suffix of (record
 * 2026-10-13-p127l-local-gaps, Amendment 2, point 1; 2026-10-12-p134c-p134d-local-dev-root-ca, the nameConstraints
 * line), so no handle on a local stack names a real domain.
 */
export const c15: Check = {
  id: "C15",
  run: withPds((env, { env: stage }) => {
    const domains = (value(env, "PDS_SERVICE_HANDLE_DOMAINS") ?? "").split(",").filter((d) => d !== "");
    if (domains.length === 0) return fail("PDS_SERVICE_HANDLE_DOMAINS is not set");
    if (domains.some((d) => d === ".0x40.me" || d.endsWith(".0x40.me"))) {
      return fail("PDS_SERVICE_HANDLE_DOMAINS includes the profile domain");
    }
    if (stage === "dev" && !(domains.length === 1 && domains[0] === ".0x40.space")) {
      return fail("PDS_SERVICE_HANDLE_DOMAINS is not the dev handle domain");
    }
    if (stage === "local" && !domains.every((domain) => underLocalHost(env, domain))) {
      return fail("PDS_SERVICE_HANDLE_DOMAINS is not under the local PDS host");
    }
    return pass();
  }),
};

/** Whether `domain` is the PDS's `.localhost` host as a suffix, or a suffix under it. */
function underLocalHost(env: SecretMap, domain: string): boolean {
  const host = value(env, "PDS_HOSTNAME") ?? "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost$/.test(host)) return false;
  return domain === `.${host}` || domain.endsWith(`.${host}`);
}

/** C16: no confirmation link in mail (plan section 5.3: "the deploy preflight fails otherwise"). */
export const c16: Check = {
  id: "C16",
  run: withPds((env) =>
    value(env, "PDS_EMAIL_DISABLE_CONFIRMATION_LINK") === "true"
      ? pass()
      : fail("PDS_EMAIL_DISABLE_CONFIRMATION_LINK does not disable the link"),
  ),
};

/** C19: moderation mail configured, under C11's TLS rule; without it the PDS drops every moderation receipt. A local
 * stack sends no mail, so there both keys must be absent (see localMail). */
export const c19: Check = {
  id: "C19",
  run: withPds((env, { env: stage }) => {
    if (stage === "local") return localMail(env, "PDS_MODERATION_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_ADDRESS");
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

/**
 * The PDS's upload bounds under local and dev (P1.36p; architecture 2026-10-19 04:53Z). @atproto/pds 0.5.37 writes a
 * temporary blob under PDS_BLOBSTORE_DISK_LOCATION's `tempt`, on the data volume, unless PDS_BLOBSTORE_DISK_TMP_LOCATION
 * moves it (dist/disk-blobstore.js:15-16, dist/config/config.js:71-76), so that key stays absent. The upload limit is
 * exact, and the PDS's only tmpfs is /tmp at exactly one size. A reason names keys only, never a value.
 */
const PINNED_UPLOAD_LIMIT = "5242880";
const PINNED_TMP_SIZE = "size=20m";

function uploadBoundsProblem(env: SecretMap, inputs: Inputs): string | null {
  if (present(env, "PDS_BLOBSTORE_DISK_TMP_LOCATION")) return "PDS_BLOBSTORE_DISK_TMP_LOCATION is set";
  if (value(env, "PDS_BLOB_UPLOAD_LIMIT") !== PINNED_UPLOAD_LIMIT)
    return "PDS_BLOB_UPLOAD_LIMIT is not the pinned limit";
  const pds = serviceNamed(inputs, "pds");
  const tmpfs = pds?.tmpfs ?? [];
  const sizes = (tmpfs[0]?.options ?? "").split(",").filter((option) => option.startsWith("size="));
  const capped =
    tmpfs.length === 1 && tmpfs[0]?.target === "/tmp" && sizes.length === 1 && sizes[0] === PINNED_TMP_SIZE;
  if (!capped || pds?.mounts.some((mount) => mount.type === "tmpfs")) {
    return "the PDS's /tmp tmpfs is not capped as pinned";
  }
  return null;
}

/**
 * C22: under local and dev, the upload bounds above; from Phase 4, the PDS accepts a blob as large as the largest video
 * master (its default is 5 MB).
 */
export const c22: Check = {
  id: "C22",
  run: withPds((env, inputs) => {
    const bounds = inputs.env === "prod" ? null : uploadBoundsProblem(env, inputs);
    if (bounds !== null) return fail(bounds);
    const master = videoMasterMax(inputs);
    if (master === null) return pass("skipped: VIDEO_MASTER_MAX_BYTES is unset");
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
    if (stage !== "prod") return pass("skipped: dev stage");
    let checked = false;
    for (const [service, env] of serviceEnv) {
      if (present(env, "FAKE_FINGERPRINT_LIST")) return fail(`FAKE_FINGERPRINT_LIST is set in ${service}`);
      if (!present(env, "FINGERPRINT_CHECK")) continue;
      if (value(env, "FINGERPRINT_CHECK") !== "arachnid")
        return fail(`FINGERPRINT_CHECK in ${service} is not the real fingerprint service`);
      checked = true;
    }
    return checked ? pass() : fail("no service sets FINGERPRINT_CHECK to the real fingerprint service");
  },
};
