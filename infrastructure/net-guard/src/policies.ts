// Egress policies (P1.18a; plan §2 rule 13, §5.2, §5.8). A policy names which hosts a request may reach; every
// outbound request names one. v1 has no model-provider policy: moderation is local (Alex answer 30b), and only an
// Alex-approved PR enabling P4.10 may add one.

export type Policy =
  /** Exact hostnames over https on port 443; answers must be public. */
  | { readonly name: string; readonly kind: "fixed"; readonly hosts: readonly string[] }
  /** An HTTP service inside the stack, by exact origin; answers must be private. Plain http is allowed only here. */
  | { readonly name: string; readonly kind: "internal"; readonly origins: readonly string[] }
  /**
   * Any host over https on port 443. A host in the guard's `internalHosts` (our own PDS, reached inside the stack)
   * must resolve only to private addresses; every other host only to public ones, and never be an internal name.
   */
  | { readonly name: string; readonly kind: "public" };

/** The PLC directory, for did:plc documents. */
export const plc: Policy = { name: "plc", kind: "fixed", hosts: ["plc.directory"] };

/** User PDSes and authorization servers, did:web documents and `.well-known/atproto-did`; our own PDS included. */
export const atproto: Policy = { name: "atproto", kind: "public" };

/** True when `origin` is exactly the serialised origin of an http or https URL (no path, case or default port). */
const isHttpOrigin = (origin: string): boolean =>
  URL.canParse(origin) && ["http:", "https:"].includes(new URL(origin).protocol) && new URL(origin).origin === origin;

/** An `internal` policy; throws (a programming error) for any origin that is not exactly an http(s) origin. */
export function internalPolicy(name: string, origins: readonly string[]): Policy {
  const bad = origins.filter((origin) => !isHttpOrigin(origin));
  if (origins.length === 0 || bad.length > 0) throw new TypeError("internal policy origins must be http(s) origins");
  return { name, kind: "internal", origins: [...origins] };
}
