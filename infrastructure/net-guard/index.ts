// net-guard (plan §2 rule 13): the single egress classifier. Every caller-influenced outbound connection resolves and
// vets its host here and connects only to the pinned addresses (a CI guard sends all such traffic through this folder).

export { type Classification, classifyAddress, isInternalName, normaliseHost } from "./src/classify.ts";
export { type AddressClass, RANGES, type Range } from "./src/ranges.ts";
export {
  type LookupAnswer,
  type NetGuardCode,
  NetGuardError,
  pinnedLookup,
  type ResolveOptions,
  resolveVetted,
} from "./src/resolve.ts";
