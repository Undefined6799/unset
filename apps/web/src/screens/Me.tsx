// The signed-in home (P2.13; plan §5.4). For now the account at a glance: the handle, shown only when it resolves
// back to the DID (P2.02), the DID itself, the PDS account link, a sign-out form and a confirm box that signs out
// every browser (P2.08a). Both post with no script. The profile, privacy and invite blocks join them in their own steps.
import { Button, Link, safeHref } from "@unset/shared-ui";
import { PrivacyNotice } from "./welcome/PrivacyNotice.tsx";

export type MeProps = {
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  handle: string;
  did: string;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  handleUnavailable: boolean;
  /** A privacy-version change: one banner, not a new acceptance (P2.12). */
  privacyNotice?: boolean;
  pdsHost: string;
};

export function Me({ handle, did, handleUnavailable, privacyNotice = false, pdsHost }: MeProps) {
  const account = safeHref(`https://${pdsHost}/account`, ["https:"]);
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
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
      <form method="post" action="/logout/everywhere">
        <label>
          <input type="checkbox" name="confirm" value="yes" />
          Sign out of every browser
        </label>
        <Button type="submit">Sign out everywhere</Button>
      </form>
    </>
  );
}
