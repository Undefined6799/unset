// The profile as the owner's page places it: the editing island, so it hydrates on pages whose route turns islands on.
// Its props have a byte limit; a profile too large for it is drawn static, the same markup with no editing.
import { IslandSlot, serializeProps } from "@unset/shared-islands";
import profileEditor from "../../islands/profile-editor.island.tsx";
import type { ProfileEditorProps } from "./ProfileEditor.tsx";
import { ProfileView } from "./ProfileView.tsx";

/** True when the island's props fit its byte limit, so the page hydrates rather than rendering it static. */
function fits(props: ProfileEditorProps): boolean {
  try {
    serializeProps(props, { maxBytes: profileEditor.maxPropsBytes });
    return true;
  } catch {
    return false;
  }
}

export function ProfileEditorSlot(props: ProfileEditorProps) {
  return fits(props) ? (
    <IslandSlot name="profile-editor" island={profileEditor} props={props} />
  ) : (
    <ProfileView {...props} />
  );
}
