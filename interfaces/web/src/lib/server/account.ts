// The account a signed-in member sees, on their own page ([did]) and on Settings › Account (P2.08b, P2.13c; ported
// from interfaces/http/routes/account-issuer.ts): the handle, shown only when it resolves back to the DID (P2.02), the
// DID, and the link to the sign-in server OAuth recorded at sign-in, never a DID-document field. The session row's
// origin, as the gate re-checked it (locals.issuerOrigin), comes first; only a session with none reads the stored
// token set, which unseals it, through the same origin check. An unreadable issuer drops the link, never the page.
import { type Did, displayHandle } from "@unset/domains-identity";
import type { Services } from "./compose.ts";
import { issuerOrigin } from "./sign-in-state.ts";

/** What the view reads: `services()` in a page, a double in a test (only these four, so a test needs no more). */
export type AccountDeps = Pick<Services, "handles" | "issuerOf" | "pdsIssuer" | "log">;

export type AccountLink = { readonly href: string; readonly host: string; readonly ours: boolean };

export type AccountView = {
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  readonly handle: string;
  readonly did: Did;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  readonly handleUnavailable: boolean;
  /** The handle verified, so a page may name the member by it. */
  readonly verified: boolean;
  /** The sign-in server's account page, or null when no https origin is known. */
  readonly accountLink: AccountLink | null;
};

/**
 * The issuer origin: the session's own as the gate re-checked it (a string to link, null to hide, never replaced by
 * another read), else, for a session with none (undefined), the token set's.
 */
async function issuerFor(deps: AccountDeps, did: Did, carried: string | null | undefined, signal: AbortSignal) {
  if (carried !== undefined) return carried;
  try {
    const issuer = await deps.issuerOf(did, signal);
    return issuer === null ? null : issuerOrigin(issuer);
  } catch (cause) {
    deps.log.warn("auth.account_issuer_unknown", { kind: cause instanceof Error ? cause.name : "Error" });
    return null;
  }
}

/** Our sign-in server's /account page, or another server's front page; only https reaches a page. */
function accountLinkOf(issuer: string | null, pdsIssuer: string): AccountLink | null {
  if (issuer === null) return null;
  const ours = issuer === pdsIssuer;
  const url = new URL(ours ? "/account" : "/", issuer);
  return url.protocol === "https:" ? { href: url.href, host: url.host, ours } : null;
}

/** The view for the signed-in DID; the handle check and the issuer read run together. */
export async function accountView(
  deps: AccountDeps,
  did: Did,
  carriedIssuer: string | null | undefined,
  signal: AbortSignal,
): Promise<AccountView> {
  // Bound first, so the syntactic floating-promise rule (scripts/lint/semgrep/floating-promises.yml) sees it is kept.
  const issuerRead = issuerFor(deps, did, carriedIssuer, signal);
  const [verdict, issuer] = await Promise.all([deps.handles.verifyHandle(did, { signal }), issuerRead]);
  return {
    handle: displayHandle(verdict),
    did,
    handleUnavailable: verdict.status === "unavailable",
    verified: verdict.status === "verified",
    accountLink: accountLinkOf(issuer, deps.pdsIssuer),
  };
}
