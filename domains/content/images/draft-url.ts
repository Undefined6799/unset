// Short-lived signed links to a member's draft image versions (book P2.19; ADR 0070 point 5). Web mints one for the
// owner's own preview; the media process checks it before it reads the object. A link is a bearer capability for at
// most ten minutes: whoever holds it can fetch that one object until `exp`, which is why the lifetime is short and no
// process logs a link. The message is `v1`, purpose, kid, object key and exp, one per line, under HMAC-SHA256; Phase 4
// adds purposes as rows of PURPOSES without changing it. Every refusal is the same `{ ok: false }`, so a caller cannot
// tell a bad signature from an unknown object or a stale link.
import { createHmac, timingSafeEqual } from "node:crypto";

/** The signing keys by key id, and the one new links are signed with (a seal-style keyring satisfies it). */
export type DraftUrlKeys = {
  readonly active: string;
  key(kid: string): Uint8Array | undefined;
};
export type DraftPurpose = "draft-preview";
export type DraftUrlCheck =
  | { readonly ok: true; readonly objectKey: string; readonly exp: number }
  | { readonly ok: false };

/** The object keys each purpose may reach: Phase 2 has one row, a draft version under `drafts/<did>/i/<id>/`. */
const PURPOSES: Readonly<Record<DraftPurpose, RegExp>> = {
  "draft-preview":
    /^drafts\/did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.-]{1,253})\/i\/[0-9a-f-]{36}\/[a-z0-9_]{1,32}\.(?:avif|webp|jpeg)$/,
};
/** A minted link's lifetime, and the furthest ahead an `exp` may lie when checked. */
export const DRAFT_URL_TTL_S = 300;
export const DRAFT_URL_MAX_AHEAD_S = 600;
const PATH = /^\/o\/([a-z-]{1,32})\/(.+)$/;
const EXP = /^[0-9]{1,12}$/;
const KID = /^[a-z0-9]{1,16}$/;
const REFUSED: DraftUrlCheck = { ok: false };

const isPurpose = (value: string): value is DraftPurpose => Object.hasOwn(PURPOSES, value);
const signature = (key: Uint8Array, purpose: string, kid: string, objectKey: string, exp: number): Buffer =>
  createHmac("sha256", key).update(`v1\n${purpose}\n${kid}\n${objectKey}\n${exp}`).digest();

/**
 * The path and query of a link to `objectKey`, valid until `now + ttlS` rounded up to the minute (so links minted in
 * the same minute are the same and cache alike). Throws a TypeError for a key the purpose may not reach: web mints
 * only keys it built.
 */
export function mintDraftPath(
  keys: DraftUrlKeys,
  objectKey: string,
  nowS: number,
  ttlS = DRAFT_URL_TTL_S,
  purpose: DraftPurpose = "draft-preview",
): string {
  if (!PURPOSES[purpose].test(objectKey)) throw new TypeError("object key outside the purpose's prefix");
  const key = keys.key(keys.active);
  if (key === undefined) throw new TypeError("the active draft link key is not held");
  const exp = Math.ceil((nowS + ttlS) / 60) * 60;
  const sig = signature(key, purpose, keys.active, objectKey, exp).toString("base64url");
  return `/o/${purpose}/${objectKey}?exp=${exp}&kid=${keys.active}&sig=${sig}`;
}

/** `exp`, `kid` and `sig`, each exactly once and nothing else; undefined otherwise. */
function exactQuery(search: string): { exp: string; kid: string; sig: string } | undefined {
  const query = new URLSearchParams(search);
  const names = [...query.keys()];
  if (names.length !== 3 || new Set(names).size !== 3) return undefined;
  const [exp, kid, sig] = [query.get("exp"), query.get("kid"), query.get("sig")];
  return exp === null || kid === null || sig === null ? undefined : { exp, kid, sig };
}

/**
 * Checks a raw request target (path and query exactly as received, never normalised), in the book's order: purpose
 * and key pattern, the exact query, a held kid, `exp` in the window, then the MAC in constant time.
 */
export function verifyDraftPath(keys: DraftUrlKeys, target: string, nowS: number): DraftUrlCheck {
  const at = target.indexOf("?");
  const [, purpose = "", objectKey = ""] = PATH.exec(at < 0 ? target : target.slice(0, at)) ?? [];
  if (!isPurpose(purpose) || !PURPOSES[purpose].test(objectKey)) return REFUSED;
  const query = at < 0 ? undefined : exactQuery(target.slice(at + 1));
  if (query === undefined || !KID.test(query.kid) || !EXP.test(query.exp)) return REFUSED;
  const key = keys.key(query.kid);
  const exp = Number(query.exp);
  if (key === undefined || nowS > exp || exp - nowS > DRAFT_URL_MAX_AHEAD_S) return REFUSED;
  const expected = signature(key, purpose, query.kid, objectKey, exp);
  // Buffer's decoder skips characters outside the alphabet, so the round trip is checked: one spelling per MAC.
  const given = Buffer.from(query.sig, "base64url");
  if (
    given.toString("base64url") !== query.sig ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  )
    return REFUSED;
  return { ok: true, objectKey, exp };
}
