// The issuer the account link follows (P2.08b): the origin OAuth recorded at sign-in, never a DID-document field.
// The account page and the settings Account page both show that link, so they share this read. An unreadable record
// drops the link, never the page.
import type { Did } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import { issuerOrigin } from "./sign-in-state.ts";

export function recordedIssuer(
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
