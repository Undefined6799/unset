// `/health`: 200 with the service and commit when ready, 503 otherwise (shared/http/health.ts). The container probe
// reads it, so server.ts skips the host check and the policy skips the rate limit.

import type { RequestHandler } from "@sveltejs/kit";
import { services } from "../../lib/server/compose.ts";

export const GET: RequestHandler = () => services().health.respond();
