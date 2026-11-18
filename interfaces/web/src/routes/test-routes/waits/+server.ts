import type { RequestHandler } from "@sveltejs/kit";

/** Never answers before the route's deadline (1 s), so the gate's 503 is what the visitor gets. */
export const GET: RequestHandler = ({ locals }) =>
  new Promise((done) => {
    const timer = setTimeout(() => done(new Response("late\n")), 3_000);
    locals.deadline.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
