// What a web route does when a call to the member's PDS fails (phase-2.md P2.13 item 7). The PDS adapter says what
// went wrong (`PdsResult`); this file, in the web process, says which page answers it. It lived in infrastructure/pds
// until P1.20k, which gave an adapter knowledge of the web's sign-in pages.
import type { PdsResult } from "@unset/infrastructure-pds";
import { withErrorParam } from "@unset/shared-errors";

export type PdsFailure =
  | { readonly action: "notice"; readonly status: 200 | 503; readonly text: string }
  | { readonly action: "redirect"; readonly location: string }
  | { readonly action: "rejected"; readonly xrpcError: string; readonly status: number };

/** A dropped grant or a missing scope goes to the sign-in pages; an outage is a notice that keeps the session. */
export function respondToPdsFailure(
  method: "GET" | "POST",
  result: Exclude<PdsResult<unknown>, { kind: "ok" }>,
  pdsHost: string,
): PdsFailure {
  if (result.kind === "transient") {
    return {
      action: "notice",
      status: method === "POST" ? 503 : 200,
      text: `${pdsHost} is not answering; your session is kept`,
    };
  }
  if (result.kind === "scope_missing") {
    return { action: "redirect", location: withErrorParam("/verify-email", "login.scope_insufficient") };
  }
  if (result.kind === "auth_dead") {
    return { action: "redirect", location: withErrorParam("/login", "login.session_ended") };
  }
  return { xrpcError: result.xrpcError, status: result.status, action: "rejected" };
}
