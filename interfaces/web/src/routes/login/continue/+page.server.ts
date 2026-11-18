// GET /login/continue (P2.05; P1.08's rule for leaving the site after a form POST): Chromium applies form-action to a
// form's redirects, so POST /login answers 303 here and this page moves on with a meta refresh, a new navigation. The
// target is the one this browser's own POST stored in its Strict cookie, checked again as a link of an allowed kind.
import type { ServerLoad } from "@sveltejs/kit";
import { config } from "../../../lib/server/runtime.ts";
import { back, storedTarget } from "../../../lib/server/sign-in.ts";

export const load: ServerLoad = ({ request }) => {
  const target = storedTarget(request);
  if (target === null) back("login.expired", null);
  const host = new URL(target).host;
  return { target: target as string, host, ours: host === config.PDS_HOSTNAME, shell: { kind: "site" } as const };
};
