// POST /logout/everywhere (P2.08j): src/lib/server/sign-out.ts. Nothing is read from the body.
import type { RequestHandler } from "@sveltejs/kit";
import { gateSession } from "../../../lib/server/session.ts";
import { signOutEverywhere } from "../../../lib/server/sign-out.ts";

export const POST: RequestHandler = (event) => signOutEverywhere(gateSession(event), event, event.locals.deadline);
