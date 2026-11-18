import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = () => {
  throw new Error("a message the visitor must never see");
};
