// The profile editing island (Alex 2026-10-23): the owner's page, editable in place (components/Profile).
import { defineIsland } from "@unset/shared-islands";
import { isProfileEditorProps, ProfileEditor } from "../components/Profile/ProfileEditor.tsx";

export default defineIsland(ProfileEditor, { propsSchema: isProfileEditorProps });
