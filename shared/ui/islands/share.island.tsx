// The share island: the profile's Share button, shown only once JS runs.
import { defineIsland } from "@unset/shared-islands";
import { isShareButtonProps, ShareButton } from "../components/Profile/ShareButton.tsx";

export default defineIsland(ShareButton, { propsSchema: isShareButtonProps });
