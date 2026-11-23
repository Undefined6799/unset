// POST /chat/dock (ADR 0115): the chat box's ticket, src/lib/server/chat-dock.ts.
import type { RequestHandler } from "@sveltejs/kit";
import { chatDockTicket } from "../../../lib/server/chat-dock.ts";

export const POST: RequestHandler = (event) => chatDockTicket(event);
