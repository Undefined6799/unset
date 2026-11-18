// GET /welcome/blocked (P2.12): neutral, with one mailto when the support address is a real email. No form and no
// stored text. The block ended every session, so most visitors here have none; a member still signed in who is not
// blocked is sent where they belong.
import type { ServerLoad } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { gateSession } from "../../../lib/server/session.ts";
import { appeal, destination, stepOf } from "../../../lib/server/welcome.ts";

export const load: ServerLoad = async (event) => {
  const session = gateSession(event);
  if (session !== undefined) {
    const step = await stepOf(session, event.locals.deadline);
    if (step !== "blocked") redirect(303, destination(step, session.emailConfirmed));
  }
  event.setHeaders({ "x-robots-tag": "noindex" });
  return { shell: { kind: "site", noindex: true } as const, appeal: appeal() as string | null };
};
