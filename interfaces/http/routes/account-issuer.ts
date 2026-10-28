// The issuer the account link follows (P2.08b): the origin OAuth recorded at sign-in, never a DID-document field.
// The account page and the settings Account page both show that link, so they share this read. An unreadable record
// drops the link, never the page. They also take the same deps and build the same account props from them.
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { issuerOrigin } from "./sign-in-state.ts";

/** What the account page (me.ts) and the settings pages (settings.ts) are given. */
export type AccountDeps = {
  /** Session, then onboarding, then a confirmed email (P2.12). A Response is the redirect. */
  open: (request: Request, deadline: AbortSignal, next: string) => Promise<Response | OpenedApp>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** The issuer OAuth recorded at sign-in (the stored token set's `iss`), or null. Never a DID-document field. */
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

/** The signed-in account's props (its checked handle and the recorded issuer, read together), and the verdict. */
export function accountProps(
  deps: AccountDeps,
): (opened: OpenedApp, deadline: AbortSignal) => Promise<{ verdict: HandleVerdict; props: AccountProps }> {
  const issuerFor = recordedIssuer(deps.issuerOf, deps.log);
  return async (opened, deadline) => {
    const did = opened.session.did;
    const [verdict, issuer] = await Promise.all([deps.verifyHandle(did, deadline), issuerFor(did)]);
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
