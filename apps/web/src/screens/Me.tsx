// The signed-in home (P2.13; plan §5.4). For now the account at a glance: the handle, shown only when it resolves
// back to the DID (P2.02), the DID itself, the link to the sign-in server recorded at sign-in (P2.08b) and a sign-out
// form that posts with no script. P2.13c: the initials avatar, a neutral profile state and the "Set up your profile"
// call to action with the Edit profile link; the draft avatar and name ride P2.18 and P2.19, the real state P2.22.
import { Avatar, Button, Card, Link, safeHref } from "@unset/shared-ui";
import { PdsAccountLink } from "./PdsAccountLink.tsx";
import { type CardView, ProfileCards } from "./profile/ProfileCards.tsx";
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
  /** The published profile's side column (ADR 0051); absent when the member has none. "" means a field is unset. */
  profile?: { displayName: string; headline: string; location: string; website: string } | null;
  /** The profile's cards in page order. */
  cards?: readonly CardView[];
  /** Their PDS could not be read just now: the page shows the account without the profile. */
  profileUnavailable?: boolean;
  /** Some cards could not be read in time: the page shows the rest and says so. */
  cardsIncomplete?: boolean;
};

const PROFILE_UNAVAILABLE = "We could not load your profile just now.";
const CARDS_INCOMPLETE = "Some of your cards could not be loaded just now. Reload to try again.";

function SideColumn({ profile, handle }: { profile: NonNullable<MeProps["profile"]>; handle: string }) {
  const website = profile.website === "" ? null : safeHref(profile.website, ["http:", "https:"]);
  return (
    <>
      <Avatar name={profile.displayName} size={64} />
      <h1>{profile.displayName}</h1>
      <p>{handle}</p>
      {profile.headline === "" ? null : <p>{profile.headline}</p>}
      {profile.location === "" ? null : <p>{profile.location}</p>}
      {website === null ? null : (
        <p>
          <Link href={website}>{profile.website.replace(/^https?:\/\//, "")}</Link>
        </p>
      )}
    </>
  );
}

const EDIT_PROFILE = safeHref("/settings/profile", ["path"]);

export function Me(props: MeProps) {
  const { handle, did, handleUnavailable, privacyNotice = false, issuer, ours } = props;
  const profile = props.profile ?? null;
  const setUp = profile === null && props.profileUnavailable !== true;
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      {profile === null ? (
        <>
          <Avatar name={handle} size={64} />
          <h1>{handle}</h1>
        </>
      ) : (
        <SideColumn profile={profile} handle={handle} />
      )}
      <p>
        <code>{did}</code>
      </p>
      {handleUnavailable ? <p>We could not check your handle just now.</p> : null}
      {props.profileUnavailable === true ? <p>{PROFILE_UNAVAILABLE}</p> : null}
      {props.cardsIncomplete === true ? <p>{CARDS_INCOMPLETE}</p> : null}
      {profile === null || EDIT_PROFILE === null ? null : (
        <p>
          <Link href={EDIT_PROFILE} variant="standalone">
            {SETTINGS.editProfile}
          </Link>
        </p>
      )}
      <ProfileCards cards={props.cards ?? []} />
      {!setUp || EDIT_PROFILE === null ? null : (
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
