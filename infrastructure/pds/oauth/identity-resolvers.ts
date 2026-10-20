// The OAuth library's identity resolvers over the identity domain (P2.04; P2.01 step C), so a login resolves handles and
// DIDs exactly as the rest of the app does: the domain's checks, its cache, its fail-closed outcomes and net-guard under
// it. @atproto/oauth-client-node 0.5.9 takes a `handleResolver` (`resolve(handle) -> did | null`) and a `didResolver`
// (`resolve(did) -> DID document`), wrapping the latter in its own bounded cache (@atproto-labs/did-resolver
// create-did-resolver.js). "Could not tell" throws, so an outage never reads as "no such handle".
import {
  type AtprotoDid,
  type AtprotoIdentityDidMethods,
  type DidResolver,
  isAtprotoDid,
  type Did as LibraryDid,
  type ResolveDidOptions,
  type ResolvedDocument,
} from "@atproto/oauth-client-node";
import {
  type Consistency,
  type Did,
  IdentityError,
  type IdentityNetwork,
  parseDid,
  parseHandle,
  type ResolvedDid,
  resolveHandle,
} from "@unset/domains-identity";

type ResolveDid = (did: Did, consistency: Consistency) => Promise<ResolvedDid>;

/** A DID the library accepts (did:plc or did:web, its blessed methods); the domain allows no other, so this never throws today. */
function atprotoDid(did: Did): AtprotoDid {
  if (!isAtprotoDid(did)) throw new IdentityError("invalid_doc");
  return did;
}

export function handleResolverForOAuth(network: IdentityNetwork) {
  return {
    async resolve(input: string): Promise<AtprotoDid | null> {
      const handle = parseHandle(input);
      if (handle === null) return null;
      const found = await resolveHandle(network, handle);
      if (found.status === "found") return atprotoDid(found.did);
      if (found.status === "not_found") return null;
      throw new IdentityError("unavailable");
    },
  };
}

/**
 * An account whose PDS is not ours (P1.36v). Thrown from inside the library's identity step, so it refuses before the
 * library asks that PDS anything: its resource metadata, its authorization server and PAR all come after.
 */
export class AccountElsewhereError extends Error {
  constructor() {
    super("account is not on our PDS");
    this.name = "AccountElsewhereError";
  }
}

/**
 * The document the library reads, rebuilt from what the domain checked: the id, the PDS service and `alsoKnownAs`,
 * which the library compares with the handle it was given (the one accepted exception to "only verifyHandle reads
 * alsoKnownAs", scripts/guards/also-known-as.ts). An unusable PDS endpoint means no service, so the login fails.
 * Only accounts on our own PDS resolve (P1.36v): a PDS origin other than `ownIssuer` throws AccountElsewhereError, for
 * sign-in and for the callback's check of the token's `sub` alike.
 */
export function didResolverForOAuth(resolveDid: ResolveDid, ownIssuer: string): DidResolver<AtprotoIdentityDidMethods> {
  return {
    async resolve<D extends LibraryDid>(input: D, options?: ResolveDidOptions) {
      const did = parseDid(input);
      if (did === null) throw new IdentityError("invalid_doc");
      const resolved = await resolveDid(did, {
        consistency: "fresh",
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (resolved.pds !== null && resolved.pds.origin !== ownIssuer) throw new AccountElsewhereError();
      const service =
        resolved.pds === null
          ? []
          : [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: resolved.pds.origin }];
      const document = { id: atprotoDid(resolved.did), alsoKnownAs: [...resolved.rawAlsoKnownAs], service };
      // The library types the result by the DID asked for; the document's id is that DID, checked by the domain.
      return document as ResolvedDocument<D, AtprotoIdentityDidMethods>;
    },
  };
}
