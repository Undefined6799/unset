// Identity (plan §2 rules 1, 13; §5.2): who an account is. P2.01 resolves DIDs and handles; the network arrives
// through the IdentityNetwork contract (ADR 0013), which infrastructure/pds implements on net-guard.
export type { FetchRequest, FetchTarget, HttpOutcome, IdentityNetwork, TxtOutcome } from "./contract.ts";
export type { ResolvedDid } from "./did-doc.ts";
export {
  type Consistency,
  createDidResolver,
  type DidResolverOptions,
  IdentityError,
  type IdentityErrorKind,
} from "./resolve-did.ts";
export { type HandleResolution, resolveHandle } from "./resolve-handle.ts";
export { type Did, type Handle, parseDid, parseHandle } from "./syntax.ts";
