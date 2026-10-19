// After signing out (P2.08; plan §5.3 "Logout"). Signing out of unset.sh does not end the session on the sign-in
// server, so the page points there; on a shared computer that is the step that matters. P2.08b: the server passes
// the issuer recorded at sign-in, so an account on another PDS is sent to its own server.
import { Link, safeHref } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";

export type SignedOutProps = {
  /** The issuer origin recorded at sign-in, or our PDS's when none was carried. */
  issuer: string;
  /** True when `issuer` is our PDS. */
  ours: boolean;
};

export function SignedOut({ issuer, ours }: SignedOutProps) {
  const signIn = safeHref("/login", ["path"]);
  return (
    <>
      <h1>You are signed out</h1>
      <p>You may still be signed in at your sign-in server. On a shared computer, sign out there too.</p>
      <PdsAccountLink issuer={issuer} ours={ours} />
      {signIn === null ? null : (
        <Link href={signIn} variant="standalone">
          Sign in again
        </Link>
      )}
    </>
  );
}
