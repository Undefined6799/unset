// DID → display handle (P2.02; plan §2 rule 1, §5.2 "handles in events are hints only"). A DID document's handle is
// self-asserted, so it is shown only when the handle resolves back to the same DID: https://atproto.com/specs/did
// ("DID Documents") and https://atproto.com/specs/handle, read from github.com/bluesky-social/atproto-website at
// 7937e9c. The claimed handle is the first syntactically valid `at://` handle in alsoKnownAs; later ones are ignored.
// An outage is `unavailable` and never cached, so it neither blocks a login nor sticks.
import type { IdentityNetwork } from "./contract.ts";
import type { ResolvedDid } from "./did-doc.ts";
import { type Consistency, IdentityError } from "./resolve-did.ts";
import { resolveHandle } from "./resolve-handle.ts";
import { type Did, type Handle, parseHandle } from "./syntax.ts";

export type HandleVerdict =
  | { readonly status: "verified"; readonly handle: Handle; readonly checkedAt: number }
  | { readonly status: "invalid"; readonly checkedAt: number }
  | { readonly status: "unavailable" };

export type HandleVerifierOptions = {
  readonly network: IdentityNetwork;
  /** The resolver from createDidResolver, shared so both use one DID document cache. */
  readonly resolveDid: (did: Did, consistency: Consistency) => Promise<ResolvedDid>;
  /** HANDLE_VERIFY_TTL_S */
  readonly verifyTtlS: number;
  /** HANDLE_INVALID_TTL_S */
  readonly invalidTtlS: number;
  /** HANDLE_CACHE_MAX */
  readonly cacheMax: number;
  /** Milliseconds; tests pass a clock. */
  readonly now?: () => number;
  /** Told of an unexpected error (never the DID: SE-7); the composition root logs it. The verdict is `unavailable`. */
  readonly onUnexpected?: (error: unknown) => void;
};

/** What the UI shows when no handle is verified; the DID is shown beside it. */
const INVALID_HANDLE = "handle.invalid";
const AT_PREFIX = "at://";

export function displayHandle(verdict: HandleVerdict): string {
  return verdict.status === "verified" ? verdict.handle : INVALID_HANDLE;
}

/** `at://` plus a handle and nothing else (no path, no `@`, no whitespace); parseHandle then lowercases it. */
function claimedHandle(resolved: ResolvedDid): Handle | null {
  for (const uri of resolved.rawAlsoKnownAs) {
    if (!uri.startsWith(AT_PREFIX)) continue;
    const rest = uri.slice(AT_PREFIX.length);
    if (rest.startsWith("@") || rest.trim() !== rest) continue;
    const handle = parseHandle(rest);
    if (handle !== null) return handle;
  }
  return null;
}

export function createHandleVerifier(options: HandleVerifierOptions) {
  const now = options.now ?? Date.now;
  // A Map keeps insertion order: re-inserting on use makes the first key the least recently used.
  const cache = new Map<Did, { verdict: HandleVerdict; expiresAt: number }>();

  const remember = (did: Did, verdict: HandleVerdict, ttlS: number): HandleVerdict => {
    cache.delete(did);
    cache.set(did, { verdict, expiresAt: now() + ttlS * 1000 });
    for (const oldest of cache.keys()) {
      if (cache.size <= options.cacheMax) break;
      cache.delete(oldest);
    }
    return verdict;
  };

  const cached = (did: Did): HandleVerdict | null => {
    const entry = cache.get(did);
    if (entry === undefined || now() >= entry.expiresAt) return null;
    cache.delete(did);
    cache.set(did, entry);
    return entry.verdict;
  };

  const invalid = (did: Did) => remember(did, { status: "invalid", checkedAt: now() }, options.invalidTtlS);

  /** The verdict from the network; IdentityError and resolver outcomes are expected, anything else throws. */
  async function check(did: Did, consistency: Consistency): Promise<HandleVerdict> {
    let resolved: ResolvedDid;
    try {
      resolved = await options.resolveDid(did, consistency);
    } catch (error) {
      if (!(error instanceof IdentityError)) throw error;
      return error.kind === "unavailable" ? { status: "unavailable" } : invalid(did);
    }
    const handle = claimedHandle(resolved);
    if (handle === null) return invalid(did);
    const resolution = await resolveHandle(options.network, handle);
    if (resolution.status === "unavailable") return { status: "unavailable" };
    if (resolution.status === "not_found" || resolution.did !== did) return invalid(did);
    return remember(did, { status: "verified", handle, checkedAt: now() }, options.verifyTtlS);
  }

  /** A reporter that throws must not turn the verdict into a throw (architecture ruling 2026-10-06, SE-7). */
  const report = (error: unknown): void => {
    try {
      options.onUnexpected?.(error);
    } catch {
      // The error was already handed over once; a failing reporter has nowhere left to report to.
    }
  };

  return {
    /** Never throws: an unexpected error is reported through onUnexpected and reads as `unavailable`. */
    async verifyHandle(did: Did, opts: Partial<Consistency> = {}): Promise<HandleVerdict> {
      const consistency = opts.consistency ?? "cached";
      const hit = consistency === "cached" ? cached(did) : null;
      if (hit !== null) return hit;
      try {
        return await check(did, { consistency });
      } catch (error) {
        report(error);
        return { status: "unavailable" };
      }
    },
    /** Drops the cached verdict, so the next call resolves again (identity events, P3.05; after login, P2.06). */
    invalidateHandle(did: Did): void {
      cache.delete(did);
    },
  };
}
