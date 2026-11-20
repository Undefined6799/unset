// A member's image library (ADR 0070 points 4, 6 and 7): who may upload, how much, and when a stored image goes.
// The rules only; infrastructure/postgres keeps the rows and applies them under a per-member lock. Every number is
// here, so the upload route, the store and the sweep agree; the store's sweep applies IMAGE_EXPIRY in its query.

/** Per member (ADR 0070 point 4). One upload at a time is web's own in-memory rule. */
export const IMAGE_ALLOWANCE = {
  perHour: 120,
  perDay: 1000,
  /** Used when the account's storage_quota_bytes is null: 2 GiB over every live image. */
  defaultQuotaBytes: 2 * 1024 ** 3,
} as const;

/** ADR 0070 point 6: an upload no save used, and a copy whose last use was removed. */
export const IMAGE_EXPIRY = { neverUsedMs: 24 * 3_600_000, unusedCopyMs: 7 * 24 * 3_600_000 } as const;

/**
 * The mass-delete governor (ADR 0070 point 6): one sweep run deletes at most `floor` images, or `share` of all live
 * images when that is more; a run that would delete more deletes nothing. A safety default proposed 2026-11-20 and
 * passed to Alex to change.
 */
export const SWEEP_GOVERNOR = { floor: 500, share: 0.1 } as const;

export type UploadUsage = {
  /** Uploads admitted in the last hour and the last 24 hours, deleted images included. */
  readonly lastHour: number;
  readonly lastDay: number;
  /** Every live image's stored bytes. */
  readonly liveBytes: number;
  /** The account's own quota; null means the default. */
  readonly quotaBytes: number | null;
};

export type ImageAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "image.hourly_limit" | "image.daily_limit" | "image.quota" };

const quotaOf = (quotaBytes: number | null) => quotaBytes ?? IMAGE_ALLOWANCE.defaultQuotaBytes;

/** Before the body is read: refused when an hour's or a day's uploads are used up, or nothing is left of the quota. */
export function admitUpload(usage: UploadUsage): ImageAdmission {
  if (usage.lastHour >= IMAGE_ALLOWANCE.perHour) return { ok: false, code: "image.hourly_limit" };
  if (usage.lastDay >= IMAGE_ALLOWANCE.perDay) return { ok: false, code: "image.daily_limit" };
  if (usage.liveBytes >= quotaOf(usage.quotaBytes)) return { ok: false, code: "image.quota" };
  return { ok: true };
}

/** Once the versions are made: they may be stored only if the total stays within the quota. */
export const fitsQuota = (liveBytes: number, bytes: number, quotaBytes: number | null): boolean =>
  liveBytes + bytes <= quotaOf(quotaBytes);

export const sweepAllowed = (due: number, live: number): boolean =>
  due <= Math.max(SWEEP_GOVERNOR.floor, Math.floor(live * SWEEP_GOVERNOR.share));

/** Origins holding only test accounts (ADR 0070 point 7). An exact origin, or any host under a suffix. */
const OPEN_ORIGINS = ["https://staging.unset.sh"];
const OPEN_HOSTS = ["localhost"];
const OPEN_SUFFIX = ".test";

/**
 * Uploads with no real inspection mounted (none exists yet): open only on the origins above, and refused as well, never
 * opened, when the environment is production or the PDS is ours in production. Fails closed on anything unparsable.
 */
export function uploadsOpen(stack: { origin: string; env: string; pdsHostname: string }): boolean {
  if (stack.env === "prod" || stack.pdsHostname === "unset.ac") return false;
  let url: URL;
  try {
    url = new URL(stack.origin);
  } catch {
    return false;
  }
  if (url.origin !== stack.origin.replace(/\/$/, "")) return false;
  const host = url.hostname;
  return OPEN_ORIGINS.includes(url.origin) || OPEN_HOSTS.includes(host) || host.endsWith(OPEN_SUFFIX);
}

/**
 * The inspection port (ADR 0070 point 2.3): nothing is mounted. A later check answers for an image's processed
 * versions with one of these; `freeze` stops the uploader's further uploads beside any verdict.
 */
export type InspectionResult = {
  readonly verdict: "pass" | "held" | "blocked";
  readonly freeze: boolean;
};
