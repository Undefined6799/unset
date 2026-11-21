// POST /logout (P2.08): src/lib/server/sign-out.ts. Only a form post gets past the gate and SvelteKit's Origin check.
import type { RequestHandler } from "@sveltejs/kit";
import { gateSession } from "../../lib/server/session.ts";
import { signOut } from "../../lib/server/sign-out.ts";

export const POST: RequestHandler = (event) => signOut(gateSession(event), event, event.locals.deadline);
