// Settings › Account (P2.13c): the handle (shown only when it resolves back to the DID, P2.02), the DID, the link to
// the sign-in server recorded at sign-in (P2.08b), where the password, email and deletion live, and a sign-out form
// that posts with no script. Sign-out ends this browser's session only, which the note says.
import { Button, DescriptionList } from "@unset/shared-ui";
import { PdsAccountLink } from "../PdsAccountLink.tsx";
import { PrivacyNotice } from "../welcome/PrivacyNotice.tsx";
import { SETTINGS } from "./messages.ts";
import styles from "./SettingsAccount.module.css";
import { SettingsShell } from "./SettingsShell.tsx";

export type SettingsAccountProps = {
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  readonly handle: string;
  readonly did: string;
  readonly handleUnavailable: boolean;
  readonly privacyNotice: boolean;
  /** The issuer origin OAuth recorded at sign-in, or null when it could not be read (no link then). */
  readonly issuer: string | null;
  /** True when `issuer` is our PDS. */
  readonly ours: boolean;
};

export function SettingsAccount({ handle, did, handleUnavailable, privacyNotice, issuer, ours }: SettingsAccountProps) {
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      <SettingsShell active="account">
        <h1>{SETTINGS.account}</h1>
        <DescriptionList
          items={[
            { label: SETTINGS.handle, value: handle, mono: true },
            { label: SETTINGS.did, value: did, mono: true },
          ]}
        />
        {handleUnavailable ? <p>{SETTINGS.handleUnavailable}</p> : null}
        {issuer === null ? null : (
          <div className={styles.server}>
            <p>{SETTINGS.accountLead}</p>
            <PdsAccountLink issuer={issuer} ours={ours} />
          </div>
        )}
        <form method="post" action="/logout" className={styles.signOut}>
          <p>{SETTINGS.signOutNote}</p>
          <Button type="submit">{SETTINGS.signOut}</Button>
        </form>
      </SettingsShell>
    </>
  );
}
