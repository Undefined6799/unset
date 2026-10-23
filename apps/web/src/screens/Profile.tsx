// The profile page (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames 174:1175 and 174:1437):
// GitHub-style, the avatar, name and short facts in a left column and the member's markdown README on the right.
// For now only the owner sees it, at /<DID>; the public page and inline editing follow. The account details that were
// here (DID, sign-in server, sign out) live on Settings › Account (P2.13c).
import { Avatar, Card, Markdown, safeHref } from "@unset/shared-ui";
import { PROFILE } from "./messages.ts";
import styles from "./Profile.module.css";
import { SETTINGS } from "./settings/messages.ts";
import { PrivacyNotice } from "./welcome/PrivacyNotice.tsx";

export type ProfileFieldsView = {
  readonly displayName: string;
  readonly headline: string;
  readonly location: string;
  /** Already checked as a plain http(s) URL by domains/profile; safeHref decides again here before it is a link. */
  readonly website: string;
  readonly readme: string;
};

export type ProfileProps = {
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  readonly handle: string;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  readonly handleUnavailable: boolean;
  readonly privacyNotice?: boolean;
  /** The published profile; null when there is none yet, "unavailable" when the PDS did not answer. */
  readonly profile: ProfileFieldsView | null | "unavailable";
};

const EDIT_PROFILE = safeHref("/settings/profile", ["path"]);

/** The website as the member typed it, without the scheme, the way a reader says it. */
function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function Facts({ fields }: { fields: ProfileFieldsView }) {
  const website = fields.website === "" ? null : safeHref(fields.website, ["https:", "http:"]);
  if (fields.location === "" && website === null) return null;
  return (
    <ul className={styles.facts}>
      {fields.location === "" ? null : <li>{fields.location}</li>}
      {website === null ? null : (
        <li>
          <a href={website} rel="nofollow ugc noopener noreferrer me">
            {websiteLabel(fields.website)}
          </a>
        </li>
      )}
    </ul>
  );
}

function SetUp() {
  return EDIT_PROFILE === null ? null : (
    <Card
      eyebrow={SETTINGS.setUpEyebrow}
      title={SETTINGS.setUpTitle}
      action={{ label: SETTINGS.editProfile, href: EDIT_PROFILE }}
    >
      {SETTINGS.setUpBody}
    </Card>
  );
}

export function Profile({ handle, handleUnavailable, privacyNotice = false, profile }: ProfileProps) {
  const fields = typeof profile === "object" && profile !== null ? profile : null;
  const name = fields !== null && fields.displayName !== "" ? fields.displayName : handle;
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      {profile === "unavailable" ? <p role="status">{PROFILE.unavailable}</p> : null}
      <div className={styles.profile}>
        <div className={styles.side}>
          <Avatar name={name} size={128} />
          <div className={styles.names}>
            <h1 className={styles.name}>{name}</h1>
            {name === handle ? null : <p className={styles.handle}>{handle}</p>}
          </div>
          {handleUnavailable ? <p>{PROFILE.handleUnavailable}</p> : null}
          {fields === null || fields.headline === "" ? null : <p className={styles.headline}>{fields.headline}</p>}
          {fields === null ? null : <Facts fields={fields} />}
        </div>
        <div className={styles.readme}>
          {fields !== null && fields.readme !== "" ? <Markdown source={fields.readme} /> : <SetUp />}
        </div>
      </div>
    </>
  );
}
