// The issuer the account link follows (P2.08b): the origin OAuth recorded at sign-in, never a DID-document field.
// The account page and the settings Account page both show that link, so they share this read. An unreadable record
// drops the link, never the page. They also take the same deps and build the same account props from them.
// The origin comes from the session row the gate already read (ADR 0048, P2.13f). Only a session created before that
// column, or one whose origin could not be stored, still reads the token set (`issuerOf`), which unseals it.
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { issuerOrigin } from "./sign-in-state.ts";

/** What the account page (me.ts) and the settings pages (settings.ts) are given. */
export type AccountDeps = {
  /** Session, then onboarding, then a confirmed email (P2.12). A Response is the redirect. */
  open: (request: Request, deadline: AbortSignal, next: string, deadlineAt: number) => Promise<Response | OpenedApp>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /**
   * The issuer OAuth recorded at sign-in (the stored token set's `iss`), or null. Never a DID-document field. Asked
   * only when the session carries no origin.
   */
  issuerOf: (did: Did) => Promise<string | null>;
  /** Our PDS's issuer origin, to tell our sign-in server from another. */
  pdsIssuer: string;
  log: Logger;
};

type AccountProps = Parameters<WebRender["screens"]["settingsAccount"]>[0];

function recordedIssuer(
  issuerOf: (did: Did) => Promise<string | null>,
  log: Logger,
): (did: Did) => Promise<string | null> {
  return (did) =>
    issuerOf(did).then(
      (issuer) => (issuer === null ? null : issuerOrigin(issuer)),
      (cause: unknown) => {
        log.warn("auth.account_issuer_unknown", { kind: cause instanceof Error ? cause.name : "Error" });
        return null;
      },
    );
}

/**
 * The origin the session row carries, checked again on the way out; null when the session has none. A stored value
 * that is no longer a bare https origin on a DNS name hides the link: it is never replaced by another read.
 */
function sessionIssuer(session: OpenedApp["session"]): { readonly origin: string | null } | null {
  const stored = session.issuerOrigin ?? null;
  if (stored === null) return null;
  return { origin: issuerOrigin(stored) === stored ? stored : null };
}

/** The signed-in account's props (its checked handle and the recorded issuer, read together), and the verdict. */
export function accountProps(
  deps: AccountDeps,
): (opened: OpenedApp, deadline: AbortSignal) => Promise<{ verdict: HandleVerdict; props: AccountProps }> {
  const issuerFor = recordedIssuer(deps.issuerOf, deps.log);
  return async (opened, deadline) => {
    const did = opened.session.did;
    const carried = sessionIssuer(opened.session);
    const [verdict, issuer] = await Promise.all([
      deps.verifyHandle(did, deadline),
      carried === null ? issuerFor(did) : carried.origin,
    ]);
    const props = {
      handle: displayHandle(verdict),
      did,
      handleUnavailable: verdict.status === "unavailable",
      privacyNotice: opened.privacyNotice,
      issuer,
      ours: issuer === deps.pdsIssuer,
    };
    return { verdict, props };
  };
}
