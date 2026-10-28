// The confirmed-email gate (P2.11; plan §2 rules 3 and 4, §5.3 "Email-verify gate"). GET /verify-email reads
// emailConfirmed from the PDS through P2.07 and never sends mail. A query string is ignored. POST
// /verify-email/reconsent starts a new authorization with prompt=consent for the same account.
import { type Did, type OnboardingAccount, type OnboardingVersions, requireOnboarded } from "@unset/domains-identity";
import type { AuthorizeResult, PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { Session } from "@unset/infrastructure-session";
import { withErrorParam } from "@unset/shared-errors";
import { defineRoute, type Route, safeReturnPath } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import type { HrefScheme, SafeHref } from "@unset/shared-ui";
import { redirectFor } from "../app-gate.ts";
import { redirect } from "../redirect.ts";
import { sessionClearCookie } from "../session-cookie.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { appStateOf, nonceCookie, targetCookie } from "./sign-in-state.ts";

export type VerifyEmailDeps = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<Session | null>;
  /** Onboarding still applies here; the email gate does not, because this page is where it sends people. */
  loadAccount: (did: Did, deadline: AbortSignal) => Promise<OnboardingAccount | null>;
  versions: OnboardingVersions;
  setEmailConfirmed: (idHash: Buffer, value: boolean, deadline: AbortSignal) => Promise<void>;
  /** P2.07 pdsSessionInfo. The only PDS read this route makes. */
  sessionInfo: (did: Did, deadline: AbortSignal) => Promise<PdsResult<SessionInfo>>;
  issueNonce: (deadline: AbortSignal) => Promise<string>;
  authorize: (
    input: string,
    options: { appState: string; prompt?: "consent"; deadline: AbortSignal },
  ) => Promise<AuthorizeResult>;
  safeHref: (value: string, schemes: readonly HrefScheme[]) => SafeHref | null;
  allowHttp: boolean;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  pdsHost: string;
  log: Logger;
};

const FORM = "application/x-www-form-urlencoded";

const login = (next: string): Response => redirect(`/login?${new URLSearchParams({ next })}`);

export function verifyEmailRoutes(deps: VerifyEmailDeps): Route[] {
  const schemes: readonly HrefScheme[] = deps.allowHttp ? ["https:", "http:"] : ["https:"];

  async function onboarded(session: Session, deadline: AbortSignal): Promise<Response | null> {
    const away = redirectFor(
      requireOnboarded(await deps.loadAccount(session.did, deadline), deps.versions),
      "/verify-email",
    );
    return away === null ? null : redirect(away);
  }

  async function show(request: Request, deadline: AbortSignal, session: Session): Promise<Response> {
    // Always a fresh read. The cache is for other pages (emailGate); this page is the check.
    const info = await deps.sessionInfo(session.did, deadline);
    if (info.kind === "auth_dead") {
      return redirect(withErrorParam("/login", "login.session_ended"), [sessionClearCookie()]);
    }
    if (info.kind === "transient" || info.kind === "rejected") return page(request, "unavailable");
    if (info.kind === "scope_missing" || info.value.emailConfirmed === undefined) return page(request, "needs_consent");
    await deps.setEmailConfirmed(session.idHash, info.value.emailConfirmed, deadline);
    return page(request, info.value.emailConfirmed ? "confirmed" : "unconfirmed");
  }

  function page(request: Request, state: "confirmed" | "unconfirmed" | "needs_consent" | "unavailable"): Response {
    return deps.page({
      group: "app",
      request,
      title: "Confirm your email",
      body: deps.screens.verifyEmail({ state, pdsHost: deps.pdsHost }),
      shell: {},
    });
  }

  return [
    defineRoute({
      method: "GET",
      path: "/verify-email",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, deadline }) => {
        const session = await deps.readSession(request, deadline);
        if (session === null) return login("/verify-email");
        const away = await onboarded(session, deadline);
        if (away !== null) return away;
        return show(request, deadline, session);
      },
    }),
    defineRoute({
      method: "POST",
      path: "/verify-email/reconsent",
      group: "app",
      accepts: [FORM],
      bodyLimit: 1024,
      rateLimit: "login",
      mutates: true,
      session: "none",
      handler: async ({ request, deadline }) => {
        const session = await deps.readSession(request, deadline);
        if (session === null) return login("/verify-email");
        const away = await onboarded(session, deadline);
        if (away !== null) return away;
        const nonce = await deps.issueNonce(deadline);
        const next = safeReturnPath("/verify-email");
        const appState = appStateOf({ nonce, expectedDid: session.did, next });
        const result = await deps.authorize(session.did, { appState, prompt: "consent", deadline });
        if (!result.ok) return redirect(withErrorParam("/verify-email", `login.${result.reason}`));
        const target = deps.safeHref(result.url.href, schemes);
        if (target === null) {
          deps.log.warn("oauth.authorize_failed", { kind: "insecure_target" });
          return redirect(withErrorParam("/verify-email", "login.failed"));
        }
        return redirect("/login/continue", [nonceCookie(nonce), targetCookie(target)]);
      },
    }),
  ];
}
