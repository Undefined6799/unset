// GET / (P1.25; P1.20d; P1.20k): the landing page's placeholder in the core shell. A visitor's copy is the same for
// every visitor, so a browser may keep it five minutes; a member's (the gate read their session, policy.ts) is sent
// private and never stored by hooks.server.ts, whatever this asks.

import type { Load } from "@sveltejs/kit";
import { PUBLIC_PAGE_CACHE, type ShellData } from "../lib/shell.ts";

const SHELL: ShellData = { kind: "core", active: "home", hiddenHeading: "Home" };

// A full load of this page ships no script. The page says so itself (book P1.22j), so its answer does not follow the
// root layout's default; the step that switches it on removes the line.
export const csr = false;

export const load: Load = ({ setHeaders }) => {
  setHeaders({ "cache-control": PUBLIC_PAGE_CACHE });
  return { shell: SHELL };
};
