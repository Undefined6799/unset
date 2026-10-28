// The menu drawer's theme picker as the drawer places it (P2.13e): an island, so it hydrates on pages whose route
// turns islands on, and stays a plain form everywhere else.
import { IslandSlot } from "@unset/shared-islands";
import themePicker from "../../islands/theme-picker.island.tsx";
import type { ThemePickerProps } from "./ThemePicker.tsx";

export function ThemePickerSlot(props: ThemePickerProps) {
  return <IslandSlot name="theme-picker" island={themePicker} props={props} />;
}
