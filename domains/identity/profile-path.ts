// The public profile's path (book P3.12 `canonicalActorPath`, plan §5.4 "Public routes"): `/@<handle>` when the
// handle is verified, else `/@<DID>`, and the one way a path segment becomes an actor. DIDs are case-sensitive and
// are never lowercased or suffixed (book R2-15); a handle is lowercased, and a bare name gets our hosted suffix, as
// sign-in reads a typed handle (interfaces/web sign-in.ts).
import { type Did, type Handle, parseDid, parseHandle } from "./syntax.ts";

/** Who a profile path names. */
export type Actor = { readonly did: Did } | { readonly handle: Handle };

/** The path segment after `/@`, or null when it is no DID and no handle we may look up (the page is then a 404). */
export function parseActor(segment: string, hostedSuffix: string): Actor | null {
  if (segment.startsWith("did:")) {
    const did = parseDid(segment);
    return did === null ? null : { did };
  }
  // parseHandle trims and drops a leading "@"; a path that differs in either is no handle of ours.
  if (segment !== segment.trim() || segment.startsWith("@")) return null;
  const lower = segment.toLowerCase();
  const handle = parseHandle(lower.includes(".") ? lower : `${lower}${hostedSuffix}`);
  return handle === null ? null : { handle };
}

/** `/@alice.unset.name` for a verified handle, else `/@did:plc:…`. Pass a handle only when it is verified. */
export function canonicalActorPath(verifiedHandle: Handle | null, did: Did): string {
  return `/@${verifiedHandle ?? did}`;
}
