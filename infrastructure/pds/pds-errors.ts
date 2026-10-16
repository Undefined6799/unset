// Classifying a PDS failure (P2.07; plan §2 rule 3). Pure: no I/O. The mappings are the error classes of
// @atproto/oauth-client 0.8.9 (re-exported by @atproto/oauth-client-node 0.5.9) and our own lock and egress errors.
// A message is never logged: TokenRefreshError's text contains the DID (session-getter.js, "The session was deleted").

import {
  OAuthResponseError,
  TokenInvalidError,
  TokenRefreshError,
  TokenRevokedError,
} from "@atproto/oauth-client-node";
import { NetGuardError } from "@unset/infrastructure-net-guard";

const NET_TRANSIENT = new Set([
  "egress.timeout",
  "egress.connect",
  "egress.dns_failed",
  "egress.dns_timeout",
  "egress.tls",
]);

export function className(error: unknown): string {
  return error instanceof Error && error.name !== "" ? error.name : "Error";
}

function record(error: unknown): Record<string, unknown> | undefined {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined;
}

export function statusOf(error: unknown): number | undefined {
  const status = record(error)?.status;
  return typeof status === "number" ? status : undefined;
}

function errorCode(error: unknown): string | undefined {
  const code = record(error)?.error;
  return typeof code === "string" ? code : undefined;
}

/** `WWW-Authenticate` from a Headers object or a plain map (the two shapes the book names). */
function authenticate(error: unknown): string | undefined {
  const headers = record(error)?.headers;
  if (headers instanceof Headers) return headers.get("www-authenticate") ?? undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  const map = headers as Record<string, unknown>;
  const value = map["www-authenticate"] ?? map["WWW-Authenticate"];
  return typeof value === "string" ? value : undefined;
}

/** RFC 9449 nonce handshake, not a dead credential. @atproto/oauth-client 0.8.9 fetch-dpop.js retries one itself. */
export function isDpopNonceHandshake(error: unknown): boolean {
  if (errorCode(error) === "use_dpop_nonce") return true;
  return authenticate(error)?.includes('error="use_dpop_nonce"') === true;
}

/**
 * A credential the caller must not keep using. A handshake 401 is not fatal (the book’s cases). Token-refresh
 * classes are decided in `restoreOutcome`, because a refresh can also fail closed as `auth_dead` for other reasons.
 */
export function isAuthFatal(error: unknown): boolean {
  if (isDpopNonceHandshake(error)) return false;
  if (statusOf(error) === 401) return true;
  return errorCode(error) === "invalid_grant";
}

export function isLockTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "LockTimeout") return true;
  // infrastructure/postgres/lock.ts throws LockError with code lock.timeout. pds cannot import that package.
  return error.name === "LockError" && record(error)?.code === "lock.timeout";
}

function netTransient(error: unknown): boolean {
  return error instanceof NetGuardError && NET_TRANSIENT.has(error.code);
}

/** What `client.restore` did. `unexpected` is still not a logout: the caller logs the class and returns transient. */
export function restoreOutcome(error: unknown): "auth_dead" | "lock_timeout" | "unavailable" | "unexpected" {
  if (
    error instanceof TokenRefreshError ||
    error instanceof TokenRevokedError ||
    error instanceof TokenInvalidError ||
    errorCode(error) === "invalid_grant"
  ) {
    return "auth_dead";
  }
  // oauth-server-agent.js:127 throws TypeError('Issuer mismatch') when the user moved their PDS.
  if (error instanceof TypeError && error.message === "Issuer mismatch") return "auth_dead";
  if (error instanceof Error && error.name === "AuthMethodUnsatisfiableError") return "auth_dead";
  if (isLockTimeout(error)) return "lock_timeout";
  if (netTransient(error)) return "unavailable";
  if (error instanceof OAuthResponseError && error.status >= 500) return "unavailable";
  return "unexpected";
}

export type OpFailure =
  | { readonly kind: "handshake" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "scope_missing"; readonly scope?: string }
  | { readonly kind: "rejected"; readonly xrpcError: string; readonly status: number }
  | { readonly kind: "retryable" }
  | { readonly kind: "unexpected" };

function xrpcName(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name === "" || error.name === "Error") return undefined;
  return error.name;
}

/** How one XRPC attempt failed. A handshake is not a 401 logout. */
export function opFailure(error: unknown): OpFailure {
  if (isDpopNonceHandshake(error)) return { kind: "handshake" };
  const status = statusOf(error);
  if (status === 401) return { kind: "unauthorized" };
  if (status === 429) return { kind: "rate_limited" };
  if (status === 403 && error instanceof Error && error.name === "ScopeMissingError") {
    const scope = record(error)?.scope;
    return typeof scope === "string" ? { kind: "scope_missing", scope } : { kind: "scope_missing" };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    const name = xrpcName(error);
    if (name !== undefined) return { kind: "rejected", xrpcError: name, status };
  }
  if (netTransient(error) || (status !== undefined && status >= 500)) return { kind: "retryable" };
  return { kind: "unexpected" };
}
