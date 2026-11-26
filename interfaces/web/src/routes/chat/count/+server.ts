// GET /chat/count (ADR 0115): the chat icon's number, read again by the shell; src/lib/server/chat-dock.ts. It reads only.
import type { RequestHandler } from "@sveltejs/kit";
import { chatCount } from "../../../lib/server/chat-dock.ts";

export const GET: RequestHandler = (event) => chatCount(event);
