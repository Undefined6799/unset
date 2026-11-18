// GET /verify-email and its reconsent action (P2.11, P2.11h; plan §2 rules 3 and 4, §5.3 "Email-verify gate"),
// ported from interfaces/http/routes/verify-email.ts (P1.20f). The page reads emailConfirmed from the PDS through
// P2.07 and never sends mail; a query string cannot change its state. Onboarding still applies here; the email gate
// does not, because this page is where it sends people. One change: while the email refresher holds this member
// after a PDS that did not answer (email-refresh.ts, 30 s), the page shows the unavailable state without asking
// again, since the gate sends a member here past the cache cap. The reconsent action (was POST
// /verify-email/reconsent) starts a new authorization with prompt=consent for the same account.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { requireOnboarded } from "@unset/domains-identity";
import { PURPOSES, withClient } from "@unset/infrastructure-postgres";
import type { Session } from "@unset/infrastructure-session";
import { withErrorParam } from "@unset/shared-errors";
import { safeReturnPath } from "@unset/shared-http";
import { safeHref } from "@unset/shared-safe-href";
import { redirectFor } from "../../lib/server/app-gate.ts";
import { services } from "../../lib/server/compose.ts";
import { config } from "../../lib/server/runtime.ts";
import { dropSessionCookie } from "../../lib/server/session.ts";
import { authorizationTarget } from "../../lib/server/sign-in.ts";
import { appStateOf, encodeTarget, putCookie } from "../../lib/server/sign-in-state.ts";
import { member, stepPage } from "../welcome/onboarding.server.ts";

type State = "confirmed" | "unconfirmed" | "needs_consent" | "unavailable";

// The core shell like every member page (P1.20k); the account menu comes from the session the gate read.
const SHELL = { kind: "core", noindex: true } as const;

/** Onboarding first: a member not past it goes to their step. */
async function onboarded(session: Session, deadline: AbortSignal): Promise<void> {
  const { accounts, versions } = services();
  const away = redirectFor(requireOnboarded(await accounts.get(session.did, deadline), versions), "/verify-email");
  if (away !== null) redirect(303, away);
}

export const load: ServerLoad = async (event) => {
  const session = stepPage(event);
  const { deadline, deadlineAt } = event.locals;
  await onboarded(session, deadline);
  // Our PDS's account page, where the member confirms the email (P2.08's account link; https only).
  const account = safeHref(`https://${config.PDS_HOSTNAME}/account`, ["https:"]) as string | null;
  const page = (state: State) => ({ shell: SHELL, state, pdsHost: config.PDS_HOSTNAME, account });
  const { email, pds, setEmailConfirmed } = services();
  if (email.onHold(session.did)) return page("unavailable");
  // Otherwise always a fresh read: the cache is for other pages (the gate); this page is the check.
  const info = await pds.pdsSessionInfo({ memo: new Map(), deadline, deadlineAt }, session.did);
  if (info.kind === "auth_dead") {
    dropSessionCookie(event.cookies);
    redirect(303, "/login?error=login.session_ended");
  }
  if (info.kind === "transient") email.hold(session.did, info);
  if (info.kind === "transient" || info.kind === "rejected") return page("unavailable");
  if (info.kind === "scope_missing" || info.value.emailConfirmed === undefined) return page("needs_consent");
  await setEmailConfirmed(session.idHash, info.value.emailConfirmed, deadline);
  return page(info.value.emailConfirmed ? "confirmed" : "unconfirmed");
};

export const actions: Actions = {
  reconsent: async (event) => {
    const session = member(event);
    const { deadline } = event.locals;
    await onboarded(session, deadline);
    const { pool, nonces } = services();
    const nonce = await withClient(pool, deadline, (db) =>
      nonces.issue(db, "login.nonce", { ttlS: PURPOSES["login.nonce"] }),
    );
    const appState = appStateOf({
      nonce,
      expectedDid: session.did,
      next: safeReturnPath("/verify-email"),
      silent: false,
    });
    const sent = await authorizationTarget(session.did, { appState, prompt: "consent", deadline });
    if (!sent.ok) redirect(303, withErrorParam("/verify-email", sent.code));
    putCookie(event.cookies, "nonce", nonce);
    putCookie(event.cookies, "target", encodeTarget(sent.target));
    redirect(303, "/login/continue");
  },
};
