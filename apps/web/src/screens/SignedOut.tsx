// After signing out (P2.08; plan §5.3 "Logout"). Signing out of unset.sh does not end the session on the sign-in
// server, so the page points there; on a shared computer that is the step that matters.
import { ERROR_MESSAGES } from "@unset/shared-errors";
import { Link, safeHref } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";

export type SignedOutProps = {
  /** Our PDS's host; its account page is where its own browser session ends. */
  pdsHost: string;
  /** A foreign issuer, when this account's sign-in server is not ours. Omitted for our PDS. */
  issuer?: string;
  /** False for a foreign issuer. Defaults to ours. */
  ours?: boolean;
  /** "Sign out everywhere" ended every browser, not only this one. */
  everywhere?: boolean;
  /** The authorization server did not confirm the grant was revoked. */
  revokeUnconfirmed?: boolean;
};

export function SignedOut({
  pdsHost,
  issuer,
  ours = true,
  everywhere = false,
  revokeUnconfirmed = false,
}: SignedOutProps) {
  const signIn = safeHref("/login", ["path"]);
  return (
    <>
      <h1>You are signed out</h1>
      {everywhere ? <p>This signed you out of every browser.</p> : null}
      {revokeUnconfirmed ? <p>{ERROR_MESSAGES["logout.revoke_unconfirmed"]}</p> : null}
      <PdsAccountLink issuer={issuer ?? `https://${pdsHost}`} ours={ours} />
      {signIn === null ? null : (
        <Link href={signIn} variant="standalone">
          Sign in again
        </Link>
      )}
    </>
  );
}
