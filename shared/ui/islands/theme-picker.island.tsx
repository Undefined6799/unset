// The theme-picker island (P2.13e): the menu drawer's theme form, saved in the background so the drawer stays open.
import { defineIsland } from "@unset/shared-islands";
import { isThemePickerProps, ThemePicker } from "../components/Navigation/ThemePicker.tsx";

export default defineIsland(ThemePicker, { propsSchema: isThemePickerProps });
