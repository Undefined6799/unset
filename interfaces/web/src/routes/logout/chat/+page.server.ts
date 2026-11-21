// GET /logout/chat (Alex 2026-11-21, ADR 0083 decision 5): between POST /logout and unset.cc's sign-out page, which
// wipes chat in this browser (lib/server/chat-sign-out.ts). Like /login/continue it leaves with a meta refresh, a new
// navigation outside the form's redirect chain that `form-action 'self'` covers. The ticket comes from the Strict
// cookie only our own POST /logout writes; it is spent here, so a reload or Back lands on the signed-out page.
import { redirect, type ServerLoad } from "@sveltejs/kit";
import { chatSignOutTarget } from "../../../lib/server/chat-sign-out.ts";
import { dropCookie } from "../../../lib/server/sign-in-state.ts";

export const load: ServerLoad = ({ request, cookies, setHeaders }) => {
  const target = chatSignOutTarget(request.headers.get("cookie"));
  dropCookie(cookies, "chatSignOut");
  if (target === null) redirect(303, "/signed-out");
  setHeaders({ "referrer-policy": "no-referrer" });
  return { target: target as string, shell: { kind: "site" } as const };
};
