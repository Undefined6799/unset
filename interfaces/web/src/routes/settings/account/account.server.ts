// What Settings › Account shows (P2.13c, P2.08b), as interfaces/http/routes/account-issuer.ts reads it: the handle only
// when it resolves back to the DID (P2.02), the DID, and the link to the sign-in server OAuth recorded at sign-in,
// never a DID-document field. The origin comes from the session row (ADR 0048, P2.13f); only a session with none
// reads the stored token set. An unreadable issuer drops the link, never the page.
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";

export type AccountDeps = {
  readonly verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  /** The issuer the stored token set records (its `iss`), or null. Asked only when the session carries no origin. */
  readonly issuerOf: (did: Did, signal: AbortSignal) => Promise<string | null>;
  /** Our PDS's issuer origin, to tell our sign-in server from another. */
  readonly pdsIssuer: string;
  readonly log: Logger;
};

/** The link to the sign-in server's account page, with the words around it; built here so the page only prints it. */
export type AccountLink = {
  readonly href: string;
  readonly host: string;
  readonly ours: boolean;
};

export type AccountView = {
  readonly handle: string;
  readonly did: Did;
  readonly handleUnavailable: boolean;
  readonly link: AccountLink | null;
};

/**
 * A bare https origin on a DNS name, or null: no other scheme, no user, password or port, no address literal, no
 * localhost, no trailing dot (P2.08h). Copied from interfaces/http/routes/sign-in-state.ts; the sign-in lane (P1.20e)
 * owns the web process's copy, and this one goes when that lands.
 */
export function issuerOrigin(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  const host = url.hostname;
  if (host.endsWith(".") || host.startsWith("[") || IPV4.test(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  return url.origin;
}

const IPV4 = /^(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])(?:\.(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])){3}$/;

/** The issuer origin: the session's own when it has one (checked again, never replaced by another read), else the
 * token set's. `carried` undefined or null means the session holds none. */
async function issuerFor(deps: AccountDeps, did: Did, carried: string | null | undefined, signal: AbortSignal) {
  if (carried !== undefined && carried !== null) return issuerOrigin(carried) === carried ? carried : null;
  try {
    const issuer = await deps.issuerOf(did, signal);
    return issuer === null ? null : issuerOrigin(issuer);
  } catch (cause) {
    deps.log.warn("auth.account_issuer_unknown", { kind: cause instanceof Error ? cause.name : "Error" });
    return null;
  }
}

/** The account link, or null: our PDS's /account page, or a foreign server's root. Only https reaches the page. */
function linkTo(issuer: string | null, pdsIssuer: string): AccountLink | null {
  if (issuer === null) return null;
  const ours = issuer === pdsIssuer;
  const url = new URL(ours ? "/account" : "/", issuer);
  return url.protocol === "https:" ? { href: url.href, host: url.host, ours } : null;
}

export async function accountView(
  deps: AccountDeps,
  did: Did,
  carriedIssuer: string | null | undefined,
  signal: AbortSignal,
): Promise<AccountView> {
  const [verdict, issuer] = await Promise.all([
    deps.verifyHandle(did, signal),
    issuerFor(deps, did, carriedIssuer, signal),
  ]);
  return {
    handle: displayHandle(verdict),
    did,
    handleUnavailable: verdict.status === "unavailable",
    link: linkTo(issuer, deps.pdsIssuer),
  };
}
