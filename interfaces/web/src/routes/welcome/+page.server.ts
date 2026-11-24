// GET /welcome (P2.12): wherever the member's onboarding stands. The load always redirects, so the route has no page
// of its own to draw and no +page.svelte (book P1.22l), as /profile has none.
import type { ServerLoad } from "@sveltejs/kit";
import { elsewhere } from "../../lib/server/welcome.ts";
import { stepPage } from "./onboarding.server.ts";

export const load: ServerLoad = async (event) => elsewhere(stepPage(event), event.locals.deadline);
