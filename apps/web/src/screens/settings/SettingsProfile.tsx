// Settings › Profile (P2.13c). Until the profile editor lands (P2.21, after the draft store P2.18), the page says what
// will live here and that the profile stays private.
import { Card } from "@unset/shared-ui";
import { PrivacyNotice } from "../welcome/PrivacyNotice.tsx";
import { SETTINGS } from "./messages.ts";
import { SettingsShell } from "./SettingsShell.tsx";

export type SettingsProfileProps = { readonly privacyNotice: boolean };

export function SettingsProfile({ privacyNotice }: SettingsProfileProps) {
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      <SettingsShell active="profile">
        <h1>{SETTINGS.profile}</h1>
        <Card eyebrow={SETTINGS.setUpEyebrow} title={SETTINGS.setUpTitle}>
          {SETTINGS.setUpBody}
        </Card>
      </SettingsShell>
    </>
  );
}
