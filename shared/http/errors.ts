// Error responses by code and route group (P1.04k). The body names the catalog code and never the exception, the
// path or any request text, so nothing a caller sends is reflected.
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import type { RouteGroup } from "./routes.ts";

/** The CSP group of a path no route matched (P1.08 assigns the same prefixes). */
export function groupForPath(path: string): RouteGroup {
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/media/")) return "media";
  if (path === "/health" || path.startsWith("/assets/")) return "static";
  if (path.startsWith("/@")) return "profile";
  return "app";
}

/** A minimal page with the code and a link home; P1.25 designs the real one. Codes and messages are fixed text. */
function errorPage(code: ErrorCode): string {
  const message = code in ERROR_MESSAGES ? ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><h1>${message}</h1><p>${code}</p><p><a href="/">Home</a></p></body></html>`;
}

/** The response for `code` in `group`: HTML for pages, JSON for the API, an empty body for media and static. */
export function errorResponse(code: ErrorCode, group: RouteGroup, headers: Record<string, string> = {}): Response {
  const shown: ErrorCode = ERROR_CODES[code].public ? code : "internal.error";
  const init = { status: ERROR_CODES[shown].status, headers: { "cache-control": "no-store", ...headers } };
  if (group === "api") return Response.json({ error: shown }, init);
  if (group === "media" || group === "static") return new Response(null, init);
  return new Response(errorPage(shown), {
    ...init,
    headers: { ...init.headers, "content-type": "text/html; charset=utf-8" },
  });
}
