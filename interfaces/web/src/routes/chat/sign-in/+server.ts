// GET /chat/sign-in?state=<one-time value> (build step 5; ADR 0081 decision 3): src/lib/server/chat-sign-in.ts. A GET
// because the door sends a top-level navigation; it changes nothing in web, and the ticket it signs is bound to the
// value the door set in this browser, so a cross-site link to it signs nobody in anywhere (csrf-coverage.test.ts).
import type { RequestHandler } from "@sveltejs/kit";
import { chatSignIn } from "../../../lib/server/chat-sign-in.ts";
import { gateSession } from "../../../lib/server/session.ts";

export const GET: RequestHandler = (event) =>
  chatSignIn(gateSession(event), event.url.searchParams, event.locals.deadline);
