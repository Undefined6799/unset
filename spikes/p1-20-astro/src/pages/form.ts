import type { APIRoute } from "astro";

export const POST: APIRoute = ({ request, redirect }) =>
  request.headers.get("sec-fetch-site") === "same-origin" ? redirect("/?ok=1", 303) : new Response(null, { status: 403 });
