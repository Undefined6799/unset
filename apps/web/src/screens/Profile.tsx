// The profile page (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames 174:1175 and 174:1437):
// GitHub-style, the avatar, name and short facts in a left column and the member's markdown README on the right.
// For now only the owner sees it, at /<DID>; the public page follows. The account details that were here (DID,
// sign-in server, sign out) live on Settings › Account (P2.13c). The owner's page hydrates the editing island
// (v4/v5, shared/ui components/Profile); with no script it is the same markup, static.
import {
  type ProfileEditorProps,
  ProfileEditorSlot,
  type ProfileFieldsView,
  type ProfileLabels,
  ProfileView,
} from "@unset/shared-ui";
import { PROFILE } from "./messages.ts";
import { PrivacyNotice } from "./welcome/PrivacyNotice.tsx";

export type { ProfileFieldsView } from "@unset/shared-ui";

export type ProfileProps = {
  readonly did: string;
  /** displayHandle's text: the verified handle, or `handle.invalid`. */
  readonly handle: string;
  /** The handle passed the two-way check. */
  readonly verified: boolean;
  /** The check could not run (an outage), as opposed to the handle failing it. */
  readonly handleUnavailable: boolean;
  readonly privacyNotice?: boolean;
  /** The published profile; null when there is none yet, "unavailable" when the PDS did not answer. */
  readonly profile: ProfileFieldsView | null | "unavailable";
};

const EMPTY: ProfileFieldsView = { displayName: "", headline: "", location: "", website: "", readme: "", links: "" };

const { unavailable: _unavailable, ...COPY } = PROFILE;
const LABELS: ProfileLabels = COPY;

export function Profile({ did, handle, verified, handleUnavailable, privacyNotice = false, profile }: ProfileProps) {
  const fields = typeof profile === "object" && profile !== null ? profile : EMPTY;
  const editor: ProfileEditorProps = { did, handle, verified, handleUnavailable, fields, labels: LABELS };
  // An unreadable profile is never editable: saving it would overwrite what the PDS holds with blanks.
  const editable = profile !== "unavailable";
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      {profile === "unavailable" ? <p role="status">{PROFILE.unavailable}</p> : null}
      {editable ? <ProfileEditorSlot {...editor} /> : <ProfileView {...editor} />}
    </>
  );
}
