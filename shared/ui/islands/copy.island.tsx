// The copy island (P1.24j): CommandBlock's copy button, shown only once JS runs.
import { defineIsland } from "@unset/shared-islands";
import { CopyButton, isCopyButtonProps } from "../components/CommandBlock/CopyButton.tsx";

export default defineIsland(CopyButton, { propsSchema: isCopyButtonProps });
