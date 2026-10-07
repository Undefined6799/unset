// The tabs island (P1.24j): the Tabs bar, with keys, and the ARIA tabs pattern in the eager mode.
import { isTabsBarProps, TabsBar } from "../components/Tabs/TabsBar.tsx";
import { defineIsland } from "./define.ts";

export default defineIsland(TabsBar, { propsSchema: isTabsBarProps });
