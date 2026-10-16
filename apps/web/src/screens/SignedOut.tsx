// After signing out (P2.08; plan §5.3 "Logout"). Signing out of unset.sh does not end the session on the sign-in
// server, so the page points there; on a shared computer that is the step that matters.
import { Link, type SafeHref, safeHref } from "@unset/shared-ui";

export type SignedOutProps = {
  /** Our PDS's host; its account page is where its own browser session ends. */
  pdsHost: string;
};

export function SignedOut({ pdsHost }: SignedOutProps) {
  const account = safeHref(`https://${pdsHost}/account`, ["https:"]);
  return (
    <main>
      <h1>You are signed out</h1>
      <p>
        {`You may still be signed in on ${pdsHost}, our sign-in server; it is the only place you type your password. `}
        On a shared computer, sign out there too.
      </p>
      {account === null ? null : (
        <Link href={account} variant="standalone">
          {`Your account on ${pdsHost}`}
        </Link>
      )}
      <Link href={"/login" as SafeHref} variant="standalone">
        Sign in again
      </Link>
    </main>
  );
}
