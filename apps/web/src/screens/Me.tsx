// The signed-in home (P2.13; plan §5.4). For now the account at a glance: the handle, shown only when it resolves
// back to the DID (P2.02), the DID itself, the link to the sign-in server recorded at sign-in (P2.08b) and a sign-out
// form that posts with no script. The profile, privacy and invite blocks join them in their own steps.
import { Button } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";
import { PrivacyNotice } from "./welcome/PrivacyNotice.tsx";

export type MeProps = {
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  handle: string;
  did: string;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  handleUnavailable: boolean;
  /** A privacy-version change: one banner, not a new acceptance (P2.12). */
  privacyNotice?: boolean;
  /** The issuer origin OAuth recorded at sign-in, or null when it could not be read (no link then). */
  issuer: string | null;
  /** True when `issuer` is our PDS. */
  ours: boolean;
};

export function Me({ handle, did, handleUnavailable, privacyNotice = false, issuer, ours }: MeProps) {
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      <h1>{handle}</h1>
      <p>
        <code>{did}</code>
      </p>
      {handleUnavailable ? <p>We could not check your handle just now.</p> : null}
      {issuer === null ? null : <PdsAccountLink issuer={issuer} ours={ours} />}
      <form method="post" action="/logout">
        <Button type="submit">Sign out</Button>
      </form>
    </>
  );
}
