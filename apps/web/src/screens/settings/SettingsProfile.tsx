// A placeholder profile page so the onboarding gate has an app route to refuse (P2.12). P2.13 replaces the body.
import { PrivacyNotice } from "../welcome/PrivacyNotice.tsx";

export type SettingsProfileProps = { readonly privacyNotice: boolean };

export function SettingsProfile({ privacyNotice }: SettingsProfileProps) {
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      <h1>Profile</h1>
    </>
  );
}
