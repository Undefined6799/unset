// The search island (P1.24u): the Search bar's keys, `/` to focus and Ctrl/Cmd+Enter to search the web.
import { defineIsland } from "@unset/shared-islands";
import { isSearchKeysProps, SearchKeys } from "../components/Search/SearchKeys.tsx";

export default defineIsland(SearchKeys, { propsSchema: isSearchKeysProps });
