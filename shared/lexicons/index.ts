// The sh.unset.* lexicons (P1.31): record validation, field limits and the OAuth scope strings. Shared with every
// process that writes or reads our records; MIT, no product rules. The one file others import (rule DC-2).
import { sh } from "./generated/index.generated.ts";

export { IMAGE_ACCEPT, LIMITS } from "./src/limits.ts";
export { scopeString, scopeStringFallback } from "./src/scope.ts";
export { type Mode, type RecordNsid, type ValidationResult, validateRecord } from "./src/validate.ts";

/**
 * Our NSIDs. The permission set's is permanent (P1.32, ADR 0020). shared/lexicons may not import shared/config, so
 * it is declared again here; P1.31c adds the shared/config test that pins it to PERMISSION_SET_NSID.
 */
export const NSID = {
  profile: sh.unset.profile.$nsid,
  section: sh.unset.section.$nsid,
  follow: sh.unset.follow.$nsid,
  authApp: sh.unset.authApp.$nsid,
} as const;
