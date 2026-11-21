// Egress policies (P1.18a; plan §2 rule 13, §5.2, §5.8). A policy names which hosts a request may reach; every
// outbound request names one. v1 has no model-provider policy: moderation is local (Alex answer 30b), and only an
// Alex-approved PR enabling P4.10 may add one.

/**
 * The largest request body a policy sends, when it names none: 1 MiB. A policy may name a larger one for its own
 * calls, up to REQUEST_BODY_CEILING; the caps below are the only ones that do (ADR 0070 point 8), each bound to one
 * call or one internal origin, and every other request keeps 1 MiB.
 */
export const DEFAULT_REQUEST_BYTES = 1024 * 1024;
/** No policy may name more: web's call to review, a 64 MiB upload with room to spare (ADR 0076). */
export const REQUEST_BODY_CEILING = 66 * 1024 * 1024;

type Caps = {
  readonly name: string;
  /** Largest request body this policy sends; absent means DEFAULT_REQUEST_BYTES. */
  readonly requestBytes?: number;
};

export type Policy =
  /** Exact hostnames over https on port 443; answers must be public. */
  | (Caps & { readonly kind: "fixed"; readonly hosts: readonly string[] })
  /** An HTTP service inside the stack, by exact origin; answers must be private. Plain http is allowed only here. */
  | (Caps & { readonly kind: "internal"; readonly origins: readonly string[] })
  /**
   * Any host over https on port 443. A host in the guard's `internalHosts` (our own PDS, reached inside the stack)
   * must resolve only to private addresses; every other host only to public ones, and never be an internal name.
   */
  | (Caps & { readonly kind: "public" });

/** The PLC directory, for did:plc documents. */
export const plc: Policy = { name: "plc", kind: "fixed", hosts: ["plc.directory"] };

/** User PDSes and authorization servers, did:web documents and `.well-known/atproto-did`; our own PDS included. */
export const atproto: Policy = { name: "atproto", kind: "public" };

/**
 * A picture's main version, the largest object a hop carries: up to 5,000,000 bytes (ADR 0088, amending ADR 0070
 * points 3 and 8), so 5 MiB gives each hop a little room and nothing more.
 */
export const PICTURE_HOP_BYTES = 5 * 1024 * 1024;

/**
 * A member's picture to their PDS (`com.atproto.repo.uploadBlob`; ADR 0070 point 8, ADR 0088): the atproto policy,
 * with a body of up to 5 MiB, room for the 5,000,000-byte main version. libraryFetch picks it for that one call only.
 */
export const atprotoBlobUpload: Policy = { name: "atproto-upload", kind: "public", requestBytes: PICTURE_HOP_BYTES };

/** True when `origin` is exactly the serialised origin of an http or https URL (no path, case or default port). */
const isHttpOrigin = (origin: string): boolean =>
  URL.canParse(origin) && ["http:", "https:"].includes(new URL(origin).protocol) && new URL(origin).origin === origin;

const validCap = (bytes: number): boolean => Number.isInteger(bytes) && bytes > 0 && bytes <= REQUEST_BODY_CEILING;

/** The largest body a request under `policy` may send; a hand-built policy past the ceiling throws (a programming error). */
export function requestCap(policy: Policy): number {
  const bytes = policy.requestBytes ?? DEFAULT_REQUEST_BYTES;
  if (!validCap(bytes)) throw new RangeError("requestBytes must be an integer in (0, 66 MiB]");
  return bytes;
}

/**
 * An `internal` policy; throws (a programming error) for any origin that is not exactly an http(s) origin, or for a
 * request cap that is not a whole number of bytes up to REQUEST_BODY_CEILING.
 */
export function internalPolicy(name: string, origins: readonly string[], requestBytes?: number): Policy {
  const bad = origins.filter((origin) => !isHttpOrigin(origin));
  if (origins.length === 0 || bad.length > 0) throw new TypeError("internal policy origins must be http(s) origins");
  if (requestBytes === undefined) return { name, kind: "internal", origins: [...origins] };
  if (!validCap(requestBytes)) throw new RangeError("requestBytes must be an integer in (0, 66 MiB]");
  return { name, kind: "internal", origins: [...origins], requestBytes };
}

/**
 * The local stack's own PLC directory (P1.34y; architecture record 2026-10-13-local-plc, Amendment 4): one exact origin,
 * plain http inside the stack, private or loopback answers (the internal kind); never a private range. It matches the
 * URL preflight C28 requires under --env local (the did-method-plc server's default port, @did-plc/server 0.0.1
 * src/bin.ts:18), and a change to one changes the other. net-guard stays env-blind: the policy is inert until a
 * composition root selects it, which P1.34z allows only under UNSET_ENV=local.
 */
export const localPlc: Policy = internalPolicy("plc", ["http://plc:2582"]);

/** What one object-store call may send or bring back: a picture's main version (ADR 0088). */
export const OBJECT_STORE_BYTES = PICTURE_HOP_BYTES;

/**
 * The private object store (P2.18k; plan §5.8 drafts store): one exact internal origin, the `OBJECT_STORE_URL` the
 * calling process's composition root passes in, so its answers must be private and no other host or port is reachable.
 * A put may carry up to 5 MiB, room for a picture's 5,000,000-byte main version (ADR 0070 point 2.4, ADR 0088). Reach
 * it through `objectStoreFetch`, which caps the answer the same.
 */
export const objectStore = (origin: string): Policy => internalPolicy("object-store", [origin], OBJECT_STORE_BYTES);

/**
 * The review process (ADR 0070 point 2.2): web's one call with a member's upload, by the `REVIEW_URL` web's composition
 * root passes in. Private answers only; a body of up to 66 MiB, above review's own job ceiling (infrastructure/image
 * wire.ts JOB_CEILING, 64 MiB), for an upload of at most 64 MiB (ADR 0076).
 */
export const review = (origin: string): Policy => internalPolicy("review", [origin], REQUEST_BODY_CEILING);

/**
 * pds-admin (P2.09k; plan §5.2): the one internal service that holds the PDS admin password. `web` reaches it by one
 * exact origin, the `PDS_ADMIN_URL` its composition root passes in, so answers must be private and nothing else is
 * reachable under this policy.
 */
export const pdsAdmin = (origin: string): Policy => internalPolicy("pds-admin", [origin]);
