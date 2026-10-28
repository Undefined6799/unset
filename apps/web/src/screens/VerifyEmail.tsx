// Confirming the account email (P2.11; plan §5.3). The server already read the PDS. This page never sends mail:
// the member confirms it on the sign-in server. A query string cannot change the state.
import { Button, Link, safeHref } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";

export type VerifyEmailState = "confirmed" | "unconfirmed" | "needs_consent" | "unavailable";

export type VerifyEmailProps = {
  state: VerifyEmailState;
  /** Our PDS host, used when `issuer` is omitted. */
  pdsHost: string;
  issuer?: string;
  ours?: boolean;
};

export function VerifyEmail({ state, pdsHost, issuer, ours = true }: VerifyEmailProps) {
  const again = safeHref("/verify-email", ["path"]);
  const home = safeHref("/did", ["path"]);
  return (
    <>
      <h1>Confirm your email</h1>
      {state === "confirmed" ? (
        <>
          <p>Your email is confirmed.</p>
          {home === null ? null : (
            <Link href={home} variant="standalone">
              Continue
            </Link>
          )}
        </>
      ) : null}
      {state === "unconfirmed" ? (
        <>
          <PdsAccountLink issuer={issuer ?? `https://${pdsHost}`} ours={ours} />
          <p>Confirm your email in the new tab, then come back here.</p>
          {again === null ? null : (
            <Link href={again} variant="standalone">
              I've confirmed it — check again
            </Link>
          )}
        </>
      ) : null}
      {state === "needs_consent" ? (
        <>
          <p>unset.sh needs permission to see whether your email is confirmed.</p>
          <form method="post" action="/verify-email/reconsent">
            <Button type="submit">Allow email access</Button>
          </form>
        </>
      ) : null}
      {state === "unavailable" ? (
        <>
          <p>{`${pdsHost} is not answering; your session is kept.`}</p>
          {again === null ? null : (
            <Link href={again} variant="standalone">
              Try again
            </Link>
          )}
        </>
      ) : null}
    </>
  );
}
