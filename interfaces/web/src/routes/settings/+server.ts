// `/settings` (P2.13c): 303 to its first page with the query kept, so a checked `?error=` still shows. Only the query
// is carried over; the path is fixed, so this cannot send the browser anywhere else. Private and varying on Cookie
// like every app page.
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = ({ url }) =>
  new Response(null, {
    status: 303,
    headers: { location: `/settings/profile${url.search}`, "cache-control": "private, no-store", vary: "Cookie" },
  });
