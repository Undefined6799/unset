// The copy island (P1.24j): CommandBlock's copy button, shown only once JS runs.
import { CopyButton, isCopyButtonProps } from "../components/CommandBlock/CopyButton.tsx";
import { defineIsland } from "./define.ts";

export default defineIsland(CopyButton, { propsSchema: isCopyButtonProps });
