// GET / (P1.25; P1.20d): the landing page's placeholder in the core shell, signed out for everyone: the page reads
// no cookie and no session, so its bytes are the same for every visitor and a browser may keep it five minutes.
import { PUBLIC_PAGE_CACHE, type ShellData } from "../lib/shell.ts";
import type { PageLoad } from "./$types";

const SHELL: ShellData = { kind: "core", active: "home", hiddenHeading: "Home" };

export const load: PageLoad = ({ setHeaders }) => {
  setHeaders({ "cache-control": PUBLIC_PAGE_CACHE });
  return { shell: SHELL };
};
