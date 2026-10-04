// net-guard (plan §2 rule 13): the single egress classifier. Every caller-influenced outbound connection resolves and
// vets its host here and connects only to the pinned addresses (a CI guard sends all such traffic through this folder).
export { type Classification, classifyAddress, isInternalName, normaliseHost } from "./src/classify.ts";
export { type FetchDefaults, guardedFetch, libraryFetch } from "./src/libraryFetch.ts";
export { atproto, type Policy, plc } from "./src/policies.ts";
export { type AddressClass, RANGES, type Range } from "./src/ranges.ts";
export {
  createNetGuard,
  type EgressEvent,
  type GuardedRequest,
  type GuardedResponse,
  type NetGuard,
  type NetGuardSettings,
} from "./src/request.ts";
export {
  type LookupAnswer,
  type NetGuardCode,
  NetGuardError,
  pinnedLookup,
  type ResolveOptions,
  resolveVetted,
} from "./src/resolve.ts";
