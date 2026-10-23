// The signed-in home (P2.13; plan §5.4). For now the account at a glance: the handle, shown only when it resolves
// back to the DID (P2.02), the DID itself, the link to the sign-in server recorded at sign-in (P2.08b) and a sign-out
// form that posts with no script. P2.13c: the initials avatar, a neutral profile state and the "Set up your profile"
// call to action with the Edit profile link; the draft avatar and name ride P2.18 and P2.19, the real state P2.22.
import { Avatar, Button, Card, safeHref } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";
import { SETTINGS } from "./settings/messages.ts";
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

const EDIT_PROFILE = safeHref("/settings/profile", ["path"]);

export function Me({ handle, did, handleUnavailable, privacyNotice = false, issuer, ours }: MeProps) {
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      <Avatar name={handle} size={64} />
      <h1>{handle}</h1>
      <p>
        <code>{did}</code>
      </p>
      {handleUnavailable ? <p>We could not check your handle just now.</p> : null}
      {EDIT_PROFILE === null ? null : (
        <Card
          eyebrow={SETTINGS.setUpEyebrow}
          title={SETTINGS.setUpTitle}
          action={{ label: SETTINGS.editProfile, href: EDIT_PROFILE }}
        >
          {SETTINGS.setUpBody}
        </Card>
      )}
      {issuer === null ? null : <PdsAccountLink issuer={issuer} ours={ours} />}
      <form method="post" action="/logout">
        <Button type="submit">Sign out</Button>
      </form>
    </>
  );
}
