// The profile page (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames 174:1175 and 174:1437):
// GitHub-style, the avatar, name and short facts in a left column and the member's README on the right, drawn from
// its stored blocks with no script. For now only the owner sees it, at /<DID>; the public page follows. The account
// details that were here (DID, sign-in server, sign out) live on Settings › Account (P2.13c). The owner edits the
// README in place (Alex 23:09Z): the page loads the editor chunk, and the pencil or a double-click opens it.
import { type ProfileFieldsView, type ProfileLabels, ProfileView } from "@unset/shared-ui";
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
  /** The stored README as the editor's document, as JSON; absent when the README cannot be edited. */
  readonly readmeDocument?: string;
};

const EMPTY: ProfileFieldsView = { displayName: "", headline: "", location: "", website: "", readme: [], links: "" };

const { unavailable: _unavailable, readmeForm: _readmeForm, ...COPY } = PROFILE;
const LABELS: ProfileLabels = COPY;

export function Profile({
  did,
  handle,
  verified,
  handleUnavailable,
  privacyNotice = false,
  profile,
  readmeDocument,
}: ProfileProps) {
  const fields = typeof profile === "object" && profile !== null ? profile : EMPTY;
  // An unreadable profile is never editable: saving it would overwrite what the PDS holds with blanks.
  const editable = profile !== "unavailable" && readmeDocument !== undefined;
  return (
    <>
      {privacyNotice ? <PrivacyNotice /> : null}
      {profile === "unavailable" ? <p role="status">{PROFILE.unavailable}</p> : null}
      <ProfileView
        did={did}
        handle={handle}
        verified={verified}
        handleUnavailable={handleUnavailable}
        fields={fields}
        labels={LABELS}
        {...(editable ? { readmeEditor: { document: readmeDocument, labels: PROFILE.readmeForm } } : {})}
      />
    </>
  );
}
