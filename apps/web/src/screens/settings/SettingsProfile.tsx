// Settings › Profile (P2.13c; Alex 2026-10-23 04:29Z: everything in the profile page's side column is edited here). A
// plain form that posts with no script to POST /profile, which changes only the fields it sends and comes back here;
// the README is edited on the profile page itself. A profile the PDS could not read is never offered for editing,
// since saving blanks over it would clear what it holds.
import { Button, Input, type ProfileFieldsView, Textarea } from "@unset/shared-ui";
import { PrivacyNotice } from "../welcome/PrivacyNotice.tsx";
import { SETTINGS } from "./messages.ts";
import styles from "./SettingsProfile.module.css";
import { SettingsShell } from "./SettingsShell.tsx";

export type SettingsProfileProps = {
  readonly privacyNotice: boolean;
  /** The published profile; null when there is none yet, "unavailable" when the PDS did not answer. */
  readonly profile: ProfileFieldsView | null | "unavailable";
};

function ProfileForm({ profile }: { profile: ProfileFieldsView | null }) {
  const value = (field: Exclude<keyof ProfileFieldsView, "readme">) => profile?.[field] ?? "";
  return (
    <form method="post" action="/profile" className={styles.form}>
      <input type="hidden" name="next" value="/settings/profile" />
      <Input label={SETTINGS.displayName} name="displayName" defaultValue={value("displayName")} required />
      <Input label={SETTINGS.headline} name="headline" defaultValue={value("headline")} />
      <Input
        label={SETTINGS.location}
        name="location"
        hint={SETTINGS.locationHint}
        defaultValue={value("location")}
        autoComplete="address-level2"
      />
      <Input
        label={SETTINGS.website}
        name="website"
        hint={SETTINGS.websiteHint}
        defaultValue={value("website")}
        inputMode="url"
      />
      <Textarea label={SETTINGS.links} name="links" hint={SETTINGS.linksHint} defaultValue={value("links")} />
      <div>
        <Button type="submit">{SETTINGS.save}</Button>
      </div>
    </form>
  );
}

export function SettingsProfile({ privacyNotice, profile }: SettingsProfileProps) {
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      <SettingsShell active="profile">
        <h1>{SETTINGS.profile}</h1>
        <p className={styles.lead}>{SETTINGS.profileLead}</p>
        {profile === "unavailable" ? (
          <p role="status">{SETTINGS.profileUnavailable}</p>
        ) : (
          <ProfileForm profile={profile} />
        )}
      </SettingsShell>
    </>
  );
}
