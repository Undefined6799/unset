// DID → DID document (P2.01; plan §2 rules 1, 13, §5.2). The outcome keeps "does not exist" (not_found) apart from
// "could not tell right now" (unavailable), so an outage is never read as a missing account. Only successes are
// cached, and a fresh read always replaces the cached entry.

import type { HttpOutcome, IdentityNetwork } from "./contract.ts";
import { parseDidDoc, type ResolvedDid } from "./did-doc.ts";
import { type Did, parseDid } from "./syntax.ts";

export type IdentityErrorKind = "not_found" | "invalid_doc" | "unavailable";

/** A DID that could not be resolved. The message is the kind only: a DID is personal data (SE-7). */
export class IdentityError extends Error {
  readonly kind: IdentityErrorKind;
  constructor(kind: IdentityErrorKind) {
    super(kind);
    this.name = "IdentityError";
    this.kind = kind;
  }
}

export type DidResolverOptions = {
  readonly network: IdentityNetwork;
  /** PLC_URL: the PLC directory origin. */
  readonly plcUrl: URL;
  /** DID_DOC_CACHE_TTL_S */
  readonly cacheTtlS: number;
  /** DID_DOC_CACHE_MAX */
  readonly cacheMax: number;
  /** Milliseconds; tests pass a clock. */
  readonly now?: () => number;
};

/**
 * `cached` may answer from the cache; `fresh` always asks the network (and refreshes the cache). Phase 2 has no PLC
 * replica, so both read PLC_URL; a later replica may serve `cached` reads only.
 */
export type Consistency = { readonly consistency: "fresh" | "cached" };

const MAX_DOC_BYTES = 64 * 1024;
const ACCEPT = "application/did+ld+json, application/json";

/** Where a DID's document lives: the PLC directory, or the did:web host's well-known path. */
function documentUrl(did: Did, plcUrl: URL): { url: URL; target: "plc" | "public" } {
  if (did.startsWith("did:plc:")) return { url: new URL(`/${did}`, plcUrl), target: "plc" };
  return { url: new URL(`https://${did.slice("did:web:".length)}/.well-known/did.json`), target: "public" };
}

/** The document in a response, or the IdentityError the outcome stands for. */
function documentOf(outcome: HttpOutcome, did: Did): ResolvedDid {
  if (outcome.kind === "refused") throw new IdentityError("invalid_doc"); // hostile or broken host, never retried
  if (outcome.kind !== "response") throw new IdentityError("unavailable");
  const { status } = outcome;
  if (status === 404 || status === 410) throw new IdentityError("not_found"); // PLC: unknown, tombstoned
  if (status === 429 || status >= 500) throw new IdentityError("unavailable");
  if (status !== 200) throw new IdentityError("invalid_doc");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(outcome.body));
  } catch {
    throw new IdentityError("invalid_doc");
  }
  const resolved = parseDidDoc(json, did);
  if (resolved === null) throw new IdentityError("invalid_doc");
  return resolved;
}

export function createDidResolver(options: DidResolverOptions) {
  const now = options.now ?? Date.now;
  // A Map keeps insertion order: re-inserting on use makes the first key the least recently used.
  const cache = new Map<Did, { resolved: ResolvedDid; at: number }>();

  const remember = (resolved: ResolvedDid): void => {
    cache.delete(resolved.did);
    cache.set(resolved.did, { resolved, at: now() });
    for (const oldest of cache.keys()) {
      if (cache.size <= options.cacheMax) break;
      cache.delete(oldest);
    }
  };

  const cached = (did: Did): ResolvedDid | null => {
    const entry = cache.get(did);
    if (entry === undefined || now() - entry.at >= options.cacheTtlS * 1000) return null;
    cache.delete(did);
    cache.set(did, entry);
    return entry.resolved;
  };

  /** Throws IdentityError: `invalid_doc` (also for a malformed DID, before any request), `not_found`, `unavailable`. */
  return async function resolveDid(did: Did, { consistency }: Consistency): Promise<ResolvedDid> {
    if (parseDid(did) === null) throw new IdentityError("invalid_doc");
    const hit = consistency === "cached" ? cached(did) : null;
    if (hit !== null) return hit;
    const { url, target } = documentUrl(did, options.plcUrl);
    const outcome = await options.network.get(url, { target, maxBytes: MAX_DOC_BYTES, accept: ACCEPT });
    const resolved = documentOf(outcome, did);
    remember(resolved);
    return resolved;
  };
}
