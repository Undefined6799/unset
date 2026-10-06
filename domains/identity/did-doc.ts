// The atproto fields of a DID document (P2.01), per https://atproto.com/specs/did ("DID Documents", "Public Keys"),
// read from github.com/bluesky-social/atproto-website at 7937e9c. `alsoKnownAs` is passed on raw and never
// interpreted here: only verifyHandle (P2.02) may decide which handle a DID claims.
import type { Did } from "./syntax.ts";

export type ResolvedDid = {
  readonly did: Did;
  /** The PDS origin, or null when the document names none we may use (the caller decides what that means). */
  readonly pds: URL | null;
  readonly signingKeyMultibase: string | null;
  readonly rawAlsoKnownAs: readonly string[];
};

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const entries = (value: unknown): Entry[] => (Array.isArray(value) ? value.filter(isEntry) : []);
/** Both the relative (`#atproto_pds`) and the fully qualified (`<did>#atproto_pds`) id forms (spec, "DID Documents"). */
const hasFragment = (entry: Entry, did: Did, fragment: string): boolean =>
  entry.id === fragment || entry.id === `${did}${fragment}`;

/** https, a host and an optional port; no userinfo, path, query or fragment. Anything else: null. */
function pdsOrigin(endpoint: unknown): URL | null {
  if (typeof endpoint !== "string" || /[?#]/.test(endpoint) || !URL.canParse(endpoint)) return null;
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/") return null;
  return url;
}

/** The first service entry with the PDS id and type decides; an unusable endpoint there is null, not a fallback. */
function pdsOf(doc: Entry, did: Did): URL | null {
  const service = entries(doc.service).find(
    (entry) => hasFragment(entry, did, "#atproto_pds") && entry.type === "AtprotoPersonalDataServer",
  );
  return service === undefined ? null : pdsOrigin(service.serviceEndpoint);
}

/** The first valid atproto signing key: id `#atproto`, type `Multikey`, controlled by the DID itself. */
function signingKeyOf(doc: Entry, did: Did): string | null {
  const key = entries(doc.verificationMethod).find(
    (entry) =>
      hasFragment(entry, did, "#atproto") &&
      entry.type === "Multikey" &&
      entry.controller === did &&
      typeof entry.publicKeyMultibase === "string",
  );
  return key === undefined ? null : (key.publicKeyMultibase as string);
}

/** The atproto view of `doc`, or null when it is not a document for `did` (its `id` must be exactly `did`). */
export function parseDidDoc(doc: unknown, did: Did): ResolvedDid | null {
  if (!isEntry(doc) || doc.id !== did) return null;
  const aka = Array.isArray(doc.alsoKnownAs) ? doc.alsoKnownAs : [];
  return {
    did,
    pds: pdsOf(doc, did),
    signingKeyMultibase: signingKeyOf(doc, did),
    rawAlsoKnownAs: aka.filter((item): item is string => typeof item === "string"),
  };
}
