// Onboarding (P2.12; plan §6 age 16). Age, then terms, then a chat placeholder. An under-16 answer blocks the
// account, writes the audit row, asks an operator when the account is on our PDS, revokes the grant and ends every
// session. The date is a local variable on the age request and is never stored or logged.
//
// @atproto/oauth-client 0.8.9 OAuthClient.revoke (dist/oauth-client.js, the revoke method) reads the stored token
// set, calls the revocation endpoint, and deletes the set in a finally. app.end_sessions_for_did also deletes that
// set, so revoke runs first. Read 2026-10-17 from the published 0.8.9 file.
import { randomUUID } from "node:crypto";
import { ageInYears, type Did, type OnboardingStep, onboardingStep, parseBirthDate } from "@unset/domains-identity";
import type { Session, SessionRead } from "@unset/infrastructure-session";
import { AppError, type ErrorCode, withErrorParam } from "@unset/shared-errors";
import { defineRoute, type Route, safeReturnPath } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import type { ReactNode } from "react";
import type { AccountStore } from "../account.ts";
import { single } from "../form-field.ts";
import { redirect } from "../redirect.ts";
import { sessionClearCookie } from "../session-cookie.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { withRevokeTimeout } from "./revoke.ts";

export type WelcomeDeps = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  accounts: AccountStore;
  versions: { readonly terms: string; readonly privacy: string };
  minAge: number;
  countryRule: boolean;
  supportEmail: string;
  /** Our PDS issuer origin, `https://host` (or `http://host` when plain HTTP is allowed). */
  pdsIssuer: string;
  /** tokenSet.iss from the sealed session, before revoke deletes the row. */
  issuerOf: (did: Did) => Promise<string | null>;
  revoke: (did: Did) => Promise<void>;
  endSessions: (did: Did, deadline: AbortSignal) => Promise<void>;
  now: () => Date;
  safeHref: WebRender["safeHref"];
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  log: Logger;
};

const FORM = "application/x-www-form-urlencoded";
const BODY = 2048;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

function termsPath(next: string | null, code?: ErrorCode): string {
  const path = next === null ? "/welcome/terms" : `/welcome/terms?${new URLSearchParams({ next })}`;
  return code === undefined ? path : withErrorParam(path, code);
}

const login = (next: string, clearCookie: boolean): Response =>
  redirect(`/login?${new URLSearchParams({ next })}`, clearCookie ? [sessionClearCookie()] : []);

function destination(step: OnboardingStep, emailConfirmed: boolean | null): string {
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
      return emailConfirmed === true ? "/did" : "/verify-email";
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}

function className(cause: unknown): string {
  return cause instanceof Error && cause.name !== "" ? cause.name : "Error";
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function hostedOnOurPds(issuer: string | null, pdsIssuer: string): boolean {
  if (issuer === null) return false;
  try {
    return new URL(issuer).origin === pdsIssuer;
  } catch {
    return false;
  }
}

/** One field of a failure, never its message: a Postgres message can quote a value. */
function failure(error: unknown): { kind: string; sqlstate?: string } {
  const kind = className(error);
  const state = sqlState(error);
  return state === undefined ? { kind } : { kind, sqlstate: state };
}

type Located =
  | { readonly kind: "in"; readonly session: Session; readonly step: OnboardingStep }
  | { readonly kind: "out"; readonly response: Response };

export function welcomeRoutes(deps: WelcomeDeps): Route[] {
  const show = (request: Request, title: string, body: ReactNode, cookies: readonly string[] = []): Response => {
    const response = deps.page({ group: "app", request, title, body, islands: "off", shell: { noindex: true } });
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  };

  async function located(request: Request, deadline: AbortSignal, next: string): Promise<Located> {
    const { session, clearCookie } = await deps.readSession(request, deadline);
    if (session === null) return { kind: "out", response: login(next, clearCookie) };
    const account = await deps.accounts.get(session.did, deadline);
    return { kind: "in", session, step: onboardingStep(account, deps.versions) };
  }

  function elsewhere(found: Located & { kind: "in" }): Response {
    return redirect(destination(found.step, found.session.emailConfirmed));
  }

  /** Block, then revoke, then end sessions. A database error on the block stops before the grant is touched. */
  async function block(session: Session, deadline: AbortSignal): Promise<Response> {
    let issuer: string | null = null;
    try {
      issuer = await deps.issuerOf(session.did);
    } catch (error) {
      // An unreadable grant is not evidence the account is ours. Block anyway, with no hosted alert.
      deps.log.warn("age_gate.issuer_unknown", failure(error));
    }
    const hosted = hostedOnOurPds(issuer, deps.pdsIssuer);
    let audit: { lane: string; seq: number } | null;
    try {
      audit = await deps.accounts.blockUnderage(session.did, hosted, deadline);
    } catch (error) {
      deps.log.warn("age_gate.block_failed", failure(error));
      throw new AppError("service.unavailable");
    }
    if (audit === null) {
      const account = await deps.accounts.get(session.did, deadline);
      const step = onboardingStep(account, deps.versions);
      if (step !== "blocked") return redirect(destination(step, session.emailConfirmed));
    } else if (hosted) deps.log.warn("age_gate.hosted_block", { kind: audit.lane, count: audit.seq });
    try {
      await withRevokeTimeout(deps.revoke(session.did), deadline);
    } catch (error) {
      deps.log.warn("oauth.revoke_failed", { kind: className(error) });
    }
    try {
      await deps.endSessions(session.did, deadline);
    } catch (error) {
      deps.log.warn("age_gate.sessions_end_failed", failure(error));
    }
    return redirect("/welcome/blocked", [sessionClearCookie()]);
  }

  function appeal(): ReturnType<WebRender["safeHref"]> {
    if (!EMAIL.test(deps.supportEmail)) return null;
    const href = `mailto:${deps.supportEmail}?${new URLSearchParams({ subject: `Appeal ${randomUUID()}` })}`;
    return deps.safeHref(href, ["mailto:"]);
  }

  const age = defineRoute({
    method: "GET",
    path: "/welcome/age",
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome/age");
      if (found.kind === "out") return found.response;
      if (found.step !== "age") return elsewhere(found);
      return show(request, "When were you born?", deps.screens.welcomeAge());
    },
  });

  const postAge = defineRoute({
    method: "POST",
    path: "/welcome/age",
    group: "app",
    accepts: [FORM],
    bodyLimit: BODY,
    rateLimit: "default",
    mutates: true,
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome/age");
      if (found.kind === "out") return found.response;
      if (found.step !== "age") return elsewhere(found);
      const form = new URLSearchParams(await request.text());
      const today = deps.now();
      const birth = parseBirthDate(
        { day: single(form, "day") ?? "", month: single(form, "month") ?? "", year: single(form, "year") ?? "" },
        today,
      );
      if (birth === null) return redirect(withErrorParam("/welcome/age", "welcome.date_invalid"));
      if (ageInYears(birth, today) < deps.minAge) return block(found.session, deadline);
      const wrote = await deps.accounts.confirmAdult(found.session.did, deadline);
      if (!wrote) {
        const again = await located(request, deadline, "/welcome/age");
        return again.kind === "out" ? again.response : elsewhere(again);
      }
      return redirect("/welcome/terms");
    },
  });

  const terms = defineRoute({
    method: "GET",
    path: "/welcome/terms",
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome/terms");
      if (found.kind === "out") return found.response;
      if (found.step !== "terms") return elsewhere(found);
      const next = safeReturnPath(new URL(request.url).searchParams.get("next"));
      return show(
        request,
        "Terms and privacy",
        deps.screens.welcomeTerms({
          countryRule: deps.countryRule,
          next,
          termsVersion: deps.versions.terms,
          privacyVersion: deps.versions.privacy,
        }),
      );
    },
  });

  const postTerms = defineRoute({
    method: "POST",
    path: "/welcome/terms",
    group: "app",
    accepts: [FORM],
    bodyLimit: BODY,
    rateLimit: "default",
    mutates: true,
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome/terms");
      if (found.kind === "out") return found.response;
      if (found.step !== "terms") return elsewhere(found);
      const form = new URLSearchParams(await request.text());
      const next = safeReturnPath(single(form, "next"));
      const shown =
        single(form, "terms_version") === deps.versions.terms &&
        single(form, "privacy_version") === deps.versions.privacy;
      if (!shown) return redirect(termsPath(next));
      if (single(form, "accept") !== "yes") return redirect(termsPath(next, "welcome.terms_required"));
      if (deps.countryRule && single(form, "country") !== "yes") {
        return redirect(termsPath(next, "welcome.country_required"));
      }
      const step = await deps.accounts.acceptTerms(
        found.session.did,
        deps.versions.terms,
        deps.versions.privacy,
        deadline,
      );
      if (step === null) {
        const again = await located(request, deadline, "/welcome/terms");
        return again.kind === "out" ? again.response : elsewhere(again);
      }
      if (step === "chat") return redirect("/welcome/chat");
      return redirect(safeReturnPath(single(form, "next")) ?? "/did");
    },
  });

  const chat = defineRoute({
    method: "GET",
    path: "/welcome/chat",
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome/chat");
      if (found.kind === "out") return found.response;
      if (found.step !== "chat") return elsewhere(found);
      return show(request, "Chat comes later", deps.screens.welcomeChat());
    },
  });

  const postChat = defineRoute({
    method: "POST",
    path: "/welcome/chat",
    group: "app",
    accepts: [FORM],
    bodyLimit: BODY,
    rateLimit: "default",
    mutates: true,
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome/chat");
      if (found.kind === "out") return found.response;
      if (found.step !== "chat") return elsewhere(found);
      const finished = await deps.accounts.finishChat(found.session.did, deadline);
      if (!finished) {
        const again = await located(request, deadline, "/welcome/chat");
        return again.kind === "out" ? again.response : elsewhere(again);
      }
      return redirect(found.session.emailConfirmed === true ? "/did" : "/verify-email");
    },
  });

  const welcome = defineRoute({
    method: "GET",
    path: "/welcome",
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: async ({ request, deadline }) => {
      const found = await located(request, deadline, "/welcome");
      if (found.kind === "out") return found.response;
      return redirect(destination(found.step, found.session.emailConfirmed));
    },
  });

  const blocked = defineRoute({
    method: "GET",
    path: "/welcome/blocked",
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: async ({ request, deadline }) => {
      const { session, clearCookie } = await deps.readSession(request, deadline);
      const cookies = clearCookie ? [sessionClearCookie()] : [];
      if (session !== null) {
        const account = await deps.accounts.get(session.did, deadline);
        const step = onboardingStep(account, deps.versions);
        if (step !== "blocked") return redirect(destination(step, session.emailConfirmed), cookies);
      }
      return show(
        request,
        "We can't offer you an account right now",
        deps.screens.welcomeBlocked({ appeal: appeal() }),
        cookies,
      );
    },
  });

  return [welcome, age, postAge, terms, postTerms, chat, postChat, blocked];
}
