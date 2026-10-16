// The tabs island (P1.24j): the Tabs bar, with keys, and the ARIA tabs pattern in the eager mode.
import { defineIsland } from "@unset/shared-islands";
import { isTabsBarProps, TabsBar } from "../components/Tabs/TabsBar.tsx";

export default defineIsland(TabsBar, { propsSchema: isTabsBarProps });
