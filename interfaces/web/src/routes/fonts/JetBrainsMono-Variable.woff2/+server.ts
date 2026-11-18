// GET /fonts/JetBrainsMono-Variable.woff2: one of the two fonts (lib/server/fonts.ts).
import type { RequestHandler } from "@sveltejs/kit";
import { font } from "../../../lib/server/fonts.ts";

export const GET: RequestHandler = () => font("JetBrainsMono-Variable.woff2");
