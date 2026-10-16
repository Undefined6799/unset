// The header-menu island (P1.24j): the Header's folded <details> menu, plus Escape-to-close and focus return.
import { defineIsland } from "@unset/shared-islands";
import { HeaderMenu, isHeaderMenuProps } from "../components/Header/HeaderMenu.tsx";

export default defineIsland(HeaderMenu, { propsSchema: isHeaderMenuProps });
