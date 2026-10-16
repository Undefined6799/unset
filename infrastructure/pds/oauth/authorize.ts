// Starting a sign-in at the account's authorization server (P2.05; plan §3, §5.3 "Login and signup"). The library's
// `authorize` (@atproto/oauth-client 0.8.9, oauth-client.js:72-140) resolves the input, stores its state with our
// appState in the sealed state store, pushes the request (PAR) and returns the URL the browser goes to. A server that
// cannot resolve our permission set refuses it with `invalid_scope` and does not fall back itself (P1.31's
// scopeStringFallback comment), so the request is made once more with the scope written out. Its errors become the few
// outcomes the login page tells apart; the authorize tests pin each one to the error the library really throws.
import { OAuthResolverError, OAuthResponseError } from "@atproto/oauth-client-node";
import { IdentityError } from "@unset/domains-identity";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import { scopeString, scopeStringFallback } from "@unset/shared-lexicons";
import type { Logger } from "@unset/shared-log";
import type { createOAuthClient } from "./oauth-client.ts";

type Client = Pick<Awaited<ReturnType<typeof createOAuthClient>>["client"], "authorize">;

export type AuthorizeFailure =
  | "handle_unverified"
  | "handle_not_found"
  | "identity_unavailable"
  | "pds_unreachable"
  | "failed";
export type AuthorizeResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: AuthorizeFailure };
export type AuthorizeOptions = {
  /** Handed back at the callback; the server never sees it (the library sends its own random `state`). */
  readonly appState: string;
  readonly prompt?: "login" | "create" | "consent";
  /** The request's deadline; the 10 s limit nests inside it (RE-1). */
  readonly deadline: AbortSignal | null;
  readonly log: Logger;
};

const AUTHORIZE_TIMEOUT_MS = 10_000;
/** net-guard codes that mean the server could not be reached, as opposed to being refused. */
const UNREACHABLE: ReadonlySet<string> = new Set([
  "egress.dns_failed",
  "egress.dns_timeout",
  "egress.connect",
  "egress.tls",
  "egress.timeout",
]);
/**
 * The library's message when the DID document does not claim the handle it was given
 * (@atproto-labs/identity-resolver 0.4.10, atproto-identity-resolver.js:66); the error class is not exported.
 */
const NOT_CLAIMED = "does not include the handle";
/** The library's prefix for every failure of the identity step (oauth-resolver.js:60). */
const IDENTITY_STEP = "Failed to resolve identity";

/** `input` is a handle, a DID or the issuer's URL (the PDS chooser). */
export async function authorize(client: Client, input: string, options: AuthorizeOptions): Promise<AuthorizeResult> {
  const timeout = AbortSignal.timeout(AUTHORIZE_TIMEOUT_MS);
  const signal = options.deadline ? AbortSignal.any([options.deadline, timeout]) : timeout;
  const request = (scope: string) =>
    client.authorize(input, {
      state: options.appState,
      scope,
      signal,
      ...(options.prompt ? { prompt: options.prompt } : {}),
    });
  try {
    return { ok: true, url: await request(scopeString()) };
  } catch (error) {
    if (!(error instanceof OAuthResponseError && error.error === "invalid_scope")) return failure(error, options.log);
  }
  options.log.info("oauth.scope_fallback_used");
  try {
    return { ok: true, url: await request(scopeStringFallback()) };
  } catch (error) {
    return failure(error, options.log);
  }
}

function failure(error: unknown, log: Logger): AuthorizeResult {
  const reason = reasonOf(error);
  if (reason === "failed") log.warn("oauth.authorize_failed", { kind: kindOf(error) });
  return { ok: false, reason };
}

function reasonOf(error: unknown): AuthorizeFailure {
  const chain = causes(error);
  if (chain.some((cause) => cause instanceof IdentityError && cause.kind === "unavailable")) {
    return "identity_unavailable";
  }
  if (error instanceof OAuthResolverError && error.message.startsWith(IDENTITY_STEP)) {
    return chain.some((cause) => cause instanceof Error && cause.message.includes(NOT_CLAIMED))
      ? "handle_unverified"
      : "handle_not_found";
  }
  const unreachable = chain.some(
    (cause) =>
      (cause instanceof NetGuardError && UNREACHABLE.has(cause.code)) ||
      (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) ||
      (cause instanceof OAuthResponseError && cause.status >= 500),
  );
  return unreachable ? "pds_unreachable" : "failed";
}

/** The error and its causes, outermost first; a short bounded walk, since a cause chain is the library's to build. */
function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = error; current !== undefined && chain.length < 8; current = (current as Error).cause) {
    chain.push(current);
    if (!(current instanceof Error)) break;
  }
  return chain;
}

/** The error's class name for the log, never its message (which can name a handle, DID or host). */
const kindOf = (error: unknown): string => (error instanceof Error ? error.constructor.name : "unknown");
