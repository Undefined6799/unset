// Starting a sign-in at the account's authorization server (P2.05; plan §3, §5.3 "Login and signup"). The library's
// `authorize` (@atproto/oauth-client 0.8.9, oauth-client.js:72-140) resolves the input, stores its state with our
// appState in the sealed state store, pushes the request (PAR) and returns the URL the browser goes to. A server that
// cannot resolve our permission set refuses it with `invalid_scope` and does not fall back itself (P1.31's
// scopeStringFallback comment), so the request is made once more with the scope written out. Its errors become the few
// outcomes the login page tells apart; the authorize tests pin each one to the error the library really throws.
// P2.06: completing it. The library's `callback` (oauth-client.js:155-223) spends its stored state (single use), checks
// `iss` against that state's issuer, exchanges the code, checks that the token's `sub` is a DID whose PDS this issuer
// serves (oauth-server-agent.js `verifyIssuer`), and stores the token set; this returns what the callback route checks.
import { OAuthCallbackError, OAuthResolverError, OAuthResponseError } from "@atproto/oauth-client-node";
import { type Did, IdentityError, parseDid } from "@unset/domains-identity";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import { scopeString, scopeStringFallback } from "@unset/shared-lexicons";
import type { Logger } from "@unset/shared-log";
import { AccountElsewhereError } from "./identity-resolvers.ts";
import type { createOAuthClient } from "./oauth-client.ts";

type Client = Awaited<ReturnType<typeof createOAuthClient>>["client"];

export type AuthorizeFailure =
  | "account_elsewhere"
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
  /** Our PDS's issuer (P1.36v): the chooser's input must be exactly it; a handle or DID must resolve to it. */
  readonly ownIssuer: string;
  readonly log: Logger;
};

const AUTHORIZE_TIMEOUT_MS = 10_000;
/** net-guard codes that mean the server could not be reached, as opposed to being refused. */
const UNREACHABLE: ReadonlySet<string> = new Set([
  "egress.dns_failed",
  "egress.dns_no_record",
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
export async function authorize(
  client: Pick<Client, "authorize">,
  input: string,
  options: AuthorizeOptions,
): Promise<AuthorizeResult> {
  // P1.36v: a server's URL is ours exactly, never a trailing slash or a case away, or nothing is sent anywhere. A
  // handle or DID is refused inside the library's identity step (didResolverForOAuth), before its PDS is asked.
  if (/^https?:\/\//i.test(input) && input !== options.ownIssuer) return { ok: false, reason: "account_elsewhere" };
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
  if (chain.some((cause) => cause instanceof AccountElsewhereError)) return "account_elsewhere";
  if (chain.some((cause) => cause instanceof IdentityError && cause.kind === "unavailable")) {
    return "identity_unavailable";
  }
  if (error instanceof OAuthResolverError && error.message.startsWith(IDENTITY_STEP)) {
    return chain.some((cause) => cause instanceof Error && cause.message.includes(NOT_CLAIMED))
      ? "handle_unverified"
      : "handle_not_found";
  }
  return unreachable(chain) ? "pds_unreachable" : "failed";
}

/** The server could not be reached or failed itself, as opposed to refusing. */
const unreachable = (chain: readonly unknown[]): boolean =>
  chain.some(
    (cause) =>
      (cause instanceof NetGuardError && UNREACHABLE.has(cause.code)) ||
      (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) ||
      (cause instanceof OAuthResponseError && cause.status >= 500),
  );

export type CallbackFailure = "account_elsewhere" | "consent_denied" | "expired" | "pds_unreachable" | "failed";
export type CompletedSignIn = {
  readonly ok: true;
  /** The account the server vouched for: the token's `sub`, checked by the library against its DID document. */
  readonly did: Did;
  readonly issuer: string;
  /** Exactly what `authorize` was given; the callback route parses it. */
  readonly appState: string;
  /** The scope the server granted, for grantCovers. */
  readonly scope: string;
  /** Revokes this grant and drops its token set; errors are swallowed only after being logged. */
  readonly revoke: () => Promise<void>;
};
export type CallbackResult = CompletedSignIn | { readonly ok: false; readonly reason: CallbackFailure };

/**
 * `query` is the callback URL's whole query, passed to the library as it came. `ownIssuer` is our PDS's issuer
 * (P1.36v): a grant from any other issuer is revoked and refused, so no session is made from it.
 */
export async function completeAuthorization(
  client: Pick<Client, "callback">,
  query: URLSearchParams,
  log: Logger,
  ownIssuer: string,
): Promise<CallbackResult> {
  let completed: Awaited<ReturnType<Client["callback"]>>;
  try {
    completed = await client.callback(query);
  } catch (error) {
    const reason = callbackReason(error);
    // A grant for an account on another PDS is a refusal worth seeing, logged by its fixed kind only (SE-7).
    if (reason === "failed" || reason === "account_elsewhere") {
      log.warn("oauth.callback_failed", { kind: reason === "failed" ? kindOf(error) : reason });
    }
    return { ok: false, reason };
  }
  const { session, state } = completed;
  const revoke = () =>
    session.signOut().catch((error: unknown) => log.warn("oauth.callback_failed", { kind: kindOf(error) }));
  if (session.serverMetadata.issuer !== ownIssuer) {
    log.warn("oauth.callback_failed", { kind: "issuer_elsewhere" });
    await revoke();
    return { ok: false, reason: "account_elsewhere" };
  }
  const did = parseDid(session.did);
  let scope: string;
  try {
    // Read from the set just stored, never refreshed (`false`): a sign-in never leaves without knowing its grant.
    scope = (await session.getTokenInfo(false)).scope;
  } catch (error) {
    log.warn("oauth.callback_failed", { kind: kindOf(error) });
    return { ok: false, reason: "failed" };
  }
  if (state === null || did === null) {
    log.warn("oauth.callback_failed", { kind: state === null ? "no_app_state" : "bad_sub" });
    return { ok: false, reason: "failed" };
  }
  return { ok: true, did, issuer: session.serverMetadata.issuer, appState: state, scope, revoke };
}

function callbackReason(error: unknown): CallbackFailure {
  if (error instanceof OAuthCallbackError) {
    // No stored state for this `state` (unknown, expired or already spent): the library throws before it has an
    // appState to attach (oauth-client.js:165-175); every later failure carries ours.
    if (error.state === undefined) return "expired";
    if (error.params.get("error") === "access_denied") return "consent_denied";
  }
  const chain = causes(error);
  if (chain.some((cause) => cause instanceof AccountElsewhereError)) return "account_elsewhere";
  return unreachable(chain) ? "pds_unreachable" : "failed";
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
