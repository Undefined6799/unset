// GET /welcome (P2.12): wherever the member's onboarding stands.
import type { ServerLoad } from "@sveltejs/kit";
import { elsewhere } from "../../lib/server/welcome.ts";
import { stepPage } from "./onboarding.server.ts";

export const load: ServerLoad = async (event) => elsewhere(stepPage(event), event.locals.deadline);
