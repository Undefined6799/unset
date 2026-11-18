// Onboarding (P2.12; plan §6 age 16), ported from interfaces/http/routes/welcome.ts for the pages under
// src/routes/welcome (P1.20f; the Hono copy goes at P1.20k). Age, then terms, then a chat placeholder. Each page
// serves only its own step and sends any other step where it belongs. An under-16 answer blocks the account, writes
// the audit row, asks an operator when the account is on our PDS, revokes the grant and ends every session. The date
// is a local variable of the age request and is never stored or logged.
//
// @atproto/oauth-client 0.8.9 OAuthClient.revoke (dist/oauth-client.js, the revoke method) reads the stored token set,
// calls the revocation endpoint, and deletes the set in a finally. app.end_sessions_for_did also deletes that set, so
// revoke runs first.
import { randomUUID } from "node:crypto";
import { type Cookies, error, redirect } from "@sveltejs/kit";
import { type OnboardingStep, onboardingStep } from "@unset/domains-identity";
import { withTransaction } from "@unset/infrastructure-postgres";
import type { Session } from "@unset/infrastructure-session";
import { type SafeHref, safeHref } from "@unset/shared-safe-href";
import { services } from "./compose.ts";
import { config } from "./runtime.ts";
import { dropSessionCookie } from "./session.ts";

/** Book P2.08: the revocation call gets 10 seconds. */
const REVOKE_MS = 10_000;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** Where a member at `step` belongs; a member who is done goes to their page, or to confirm their email first. */
export function destination(step: OnboardingStep, emailConfirmed: boolean | null): string {
  switch (step) {
    case "age":
      return "/welcome/age";
    case "terms":
      return "/welcome/terms";
    case "chat":
      return "/welcome/chat";
    case "blocked":
      return "/welcome/blocked";
    case "done":
      return emailConfirmed === true ? "/me" : "/verify-email";
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}

/** The member's step now. */
export async function stepOf(session: Session, deadline: AbortSignal): Promise<OnboardingStep> {
  const { accounts, versions } = services();
  return onboardingStep(await accounts.get(session.did, deadline), versions);
}

/** The page of `step` may render; any other step sends the member where they belong (a 303). */
export async function requireStep(session: Session, deadline: AbortSignal, step: OnboardingStep): Promise<void> {
  const now = await stepOf(session, deadline);
  if (now !== step) redirect(303, destination(now, session.emailConfirmed));
}

/** After a write that changed nothing (another tab moved first): wherever the member now belongs. */
export async function elsewhere(session: Session, deadline: AbortSignal): Promise<never> {
  redirect(303, destination(await stepOf(session, deadline), session.emailConfirmed));
}

const className = (cause: unknown): string => (cause instanceof Error && cause.name !== "" ? cause.name : "Error");

/** One field of a failure, never its message: a Postgres message can quote a value. */
function failure(cause: unknown): { kind: string; sqlstate?: string } {
  const kind = className(cause);
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code: unknown }).code : null;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? { kind, sqlstate: code } : { kind };
}

/** True when the grant's issuer is our PDS: compared as origins, never by suffix. */
function hostedOnOurPds(issuer: string | null): boolean {
  return issuer !== null && URL.canParse(issuer) && new URL(issuer).origin === services().pdsIssuer;
}

/** `work`, or a rejection after 10 seconds or when `deadline` aborts, whichever comes first. */
function withRevokeTimeout(work: Promise<void>, deadline: AbortSignal): Promise<void> {
  const limit = AbortSignal.any([deadline, AbortSignal.timeout(REVOKE_MS)]);
  if (limit.aborted) return Promise.reject(new Error("revoke timed out"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("revoke timed out"));
    limit.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => limit.removeEventListener("abort", onAbort));
  });
}

/**
 * The under-age block: block (with its audit row), then revoke, then end every session. A database error on the block
 * stops before the grant is touched. Always ends in a 303 to the blocked page with this browser's cookie cleared.
 */
export async function blockUnderage(session: Session, cookies: Cookies, deadline: AbortSignal): Promise<never> {
  const { accounts, issuerOf, oauth, pool, sessions, log } = services();
  let issuer: string | null = null;
  try {
    issuer = await issuerOf(session.did);
  } catch (cause) {
    // An unreadable grant is not evidence the account is ours. Block anyway, with no hosted alert.
    log.warn("age_gate.issuer_unknown", failure(cause));
  }
  const hosted = hostedOnOurPds(issuer);
  let audit: { lane: string; seq: number } | null;
  try {
    audit = await accounts.blockUnderage(session.did, hosted, deadline);
  } catch (cause) {
    log.warn("age_gate.block_failed", failure(cause));
    error(503, { message: "service.unavailable" });
  }
  if (audit === null) {
    // Nothing was blocked: another step already holds. Only an account that is blocked goes on to the revoke.
    const step = await stepOf(session, deadline);
    if (step !== "blocked") redirect(303, destination(step, session.emailConfirmed));
  } else if (hosted) log.warn("age_gate.hosted_block", { kind: audit.lane, count: audit.seq });
  try {
    await withRevokeTimeout(oauth.client.revoke(session.did), deadline);
  } catch (cause) {
    log.warn("oauth.revoke_failed", { kind: className(cause) });
  }
  try {
    await withTransaction(pool, deadline, (tx) => sessions.destroyAllForDid(tx, session.did, "underage"));
  } catch (cause) {
    log.warn("age_gate.sessions_end_failed", failure(cause));
  }
  dropSessionCookie(cookies);
  redirect(303, "/welcome/blocked");
}

/** The appeal link: a mailto with a fresh reference, only when SUPPORT_EMAIL is a real address. */
export function appeal(): SafeHref | null {
  if (!EMAIL.test(config.SUPPORT_EMAIL)) return null;
  const href = `mailto:${config.SUPPORT_EMAIL}?${new URLSearchParams({ subject: `Appeal ${randomUUID()}` })}`;
  return safeHref(href, ["mailto:"]);
}
