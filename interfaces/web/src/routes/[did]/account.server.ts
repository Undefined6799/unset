// The account part of the member's own page (P2.08b, P2.13; ported from interfaces/http/routes/account-issuer.ts and
// sign-in-state.ts issuerOrigin, P1.20g): the handle, shown only when it resolves back to the DID (P2.02), and the
// link to the sign-in server OAuth recorded at sign-in, never a DID-document field. The session row's origin is used
// when it has one; only a session without one reads the stored token set, which unseals it. An unreadable issuer drops
// the link, never the page.
import { type Did, displayHandle } from "@unset/domains-identity";
import { services } from "../../lib/server/compose.ts";

export type AccountView = {
  readonly handle: string;
  readonly did: string;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  readonly handleUnavailable: boolean;
  /** The handle verified, so the page may name it. */
  readonly verified: boolean;
  /** The sign-in server's account page, or null when no https origin was recorded. */
  readonly accountLink: { readonly href: string; readonly host: string; readonly ours: boolean } | null;
};

/** Four decimal octets, the form WHATWG gives an IPv4 address (0-255, no leading zero except 0). */
const IPV4 = /^(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])(?:\.(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])){3}$/;

/** A DNS hostname: not an address, not localhost, and not a trailing dot (P2.08h). `hostname` is WHATWG's. */
function dnsNameHost(hostname: string): boolean {
  if (hostname.endsWith(".") || hostname.startsWith("[") || IPV4.test(hostname)) return false;
  return hostname !== "localhost" && !hostname.endsWith(".localhost");
}

/** A bare https origin on a DNS name, or null. */
export function issuerOrigin(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (!dnsNameHost(url.hostname)) return null;
  return url.origin;
}

/** The recorded issuer: the session's origin when it has one (re-checked, never replaced), else the token set's. */
async function recordedIssuer(did: Did, sessionOrigin: string | null | undefined, deadline: AbortSignal) {
  if (typeof sessionOrigin === "string") return issuerOrigin(sessionOrigin) === sessionOrigin ? sessionOrigin : null;
  const { issuerOf, log } = services();
  try {
    const issuer = await issuerOf(did, deadline);
    return issuer === null ? null : issuerOrigin(issuer);
  } catch (cause) {
    log.warn("auth.account_issuer_unknown", { kind: cause instanceof Error ? cause.name : "Error" });
    return null;
  }
}

/** Our sign-in server's /account page, or another server's front page; null when the origin is not https. */
function accountLinkOf(issuer: string | null, pdsIssuer: string): AccountView["accountLink"] {
  if (issuer === null) return null;
  const ours = issuer === pdsIssuer;
  const url = new URL(ours ? "/account" : "/", issuer);
  return url.protocol === "https:" ? { href: url.href, host: url.host, ours } : null;
}

/** The account view for the signed-in DID; the handle check and the issuer read run together. */
export async function accountView(
  did: Did,
  sessionOrigin: string | null | undefined,
  deadline: AbortSignal,
): Promise<AccountView> {
  const { handles, pdsIssuer } = services();
  const [verdict, issuer] = await Promise.all([
    handles.verifyHandle(did, { signal: deadline }),
    recordedIssuer(did, sessionOrigin, deadline),
  ]);
  return {
    handle: displayHandle(verdict),
    did,
    handleUnavailable: verdict.status === "unavailable",
    verified: verdict.status === "verified",
    accountLink: accountLinkOf(issuer, pdsIssuer),
  };
}
