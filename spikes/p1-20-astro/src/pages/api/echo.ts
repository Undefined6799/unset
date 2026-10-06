import type { APIRoute } from "astro";

export const GET: APIRoute = ({ url }) => Response.json({ q: url.searchParams.get("q") ?? "" });
