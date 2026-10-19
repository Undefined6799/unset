// After signing out (P2.08; plan §5.3 "Logout"). Signing out of unset.sh does not end the session on the sign-in
// server, so the page points there; on a shared computer that is the step that matters.
import { Link, safeHref } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";

export type SignedOutProps = {
  /** Our PDS's host; its account page is where its own browser session ends. */
  pdsHost: string;
  /** A foreign issuer, when this account's sign-in server is not ours. Omitted for our PDS. */
  issuer?: string;
  /** False for a foreign issuer. Defaults to ours. */
  ours?: boolean;
};

export function SignedOut({ pdsHost, issuer, ours = true }: SignedOutProps) {
  const signIn = safeHref("/login", ["path"]);
  return (
    <>
      <h1>You are signed out</h1>
      <PdsAccountLink issuer={issuer ?? `https://${pdsHost}`} ours={ours} />
      {signIn === null ? null : (
        <Link href={signIn} variant="standalone">
          Sign in again
        </Link>
      )}
    </>
  );
}
