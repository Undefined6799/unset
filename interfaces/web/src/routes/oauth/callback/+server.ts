// GET /oauth/callback (P2.06): src/lib/server/oauth-callback.ts.
import type { RequestHandler } from "@sveltejs/kit";
import { completeSignIn } from "../../../lib/server/oauth-callback.ts";

export const GET: RequestHandler = ({ request, cookies, locals }) =>
  completeSignIn({ request, cookies, deadline: locals.deadline, deadlineAt: locals.deadlineAt });
