// The signed-in home (P2.13; plan §5.4). For now the account at a glance: the handle, shown only when it resolves
// back to the DID (P2.02), the DID itself, the PDS account link and a sign-out form that posts with no script. The
// profile, privacy and invite blocks join it in their own steps.
import { Button, Link, safeHref } from "@unset/shared-ui";

export type MeProps = {
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  handle: string;
  did: string;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  handleUnavailable: boolean;
  pdsHost: string;
};

export function Me({ handle, did, handleUnavailable, pdsHost }: MeProps) {
  const account = safeHref(`https://${pdsHost}/account`, ["https:"]);
  return (
    <main>
      <h1>{handle}</h1>
      <p>
        <code>{did}</code>
      </p>
      {handleUnavailable ? <p>We could not check your handle just now.</p> : null}
      {account === null ? null : (
        <Link href={account} variant="standalone">
          {`Your account on ${pdsHost}`}
        </Link>
      )}
      <form method="post" action="/logout">
        <Button type="submit">Sign out</Button>
      </form>
    </main>
  );
}
