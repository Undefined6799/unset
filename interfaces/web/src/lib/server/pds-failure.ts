// What a web route does when a call to the member's PDS fails (phase-2.md P2.13 item 7). The PDS adapter says what
// went wrong (`PdsResult`); this file, in the web process, says which page answers it. It lived in infrastructure/pds
// until P1.20k, which gave an adapter knowledge of the web's sign-in pages.
import type { PdsResult } from "@unset/infrastructure-pds";
import { withErrorParam } from "@unset/shared-errors";

/**
 * Where a dropped grant or a missing scope sends the member: the sign-in pages. Null for any other failure (an outage,
 * a refused record), which each caller answers in its own page and which keeps the session.
 */
export function pdsSignInRedirect(result: Exclude<PdsResult<unknown>, { kind: "ok" }>): string | null {
  // A grant from before a permission the app now asks for (staging, 2026-11-21): /allow asks the member to consent
  // again. Not /verify-email, which is about the email permission and showed "confirmed" for a card write.
  if (result.kind === "scope_missing") return "/allow";
  if (result.kind === "auth_dead") return withErrorParam("/login", "login.session_ended");
  return null;
}
