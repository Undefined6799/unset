// The header-menu island (P1.24j): the Header's folded <details> menu, plus Escape-to-close and focus return.
import { HeaderMenu, isHeaderMenuProps } from "../components/Header/HeaderMenu.tsx";
import { defineIsland } from "./define.ts";

export default defineIsland(HeaderMenu, { propsSchema: isHeaderMenuProps });
