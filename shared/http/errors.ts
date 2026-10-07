// Error responses by code and route group (P1.04k). The body names the catalog code and never the exception, the
// path or any request text, so nothing a caller sends is reflected. P1.25k: a page group's body may come from the
// interface's error page instead (server.ts runs the hook); the status and every header stay the kit's.
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from "@unset/shared-errors";
import type { Logger } from "@unset/shared-log";
import type { RouteGroup } from "./routes.ts";

/** The CSP group of a path no route matched (P1.08 assigns the same prefixes). */
export function groupForPath(path: string): RouteGroup {
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/media/")) return "media";
  if (path === "/health" || path.startsWith("/assets/")) return "static";
  if (path.startsWith("/@")) return "profile";
  return "app";
}

/** The groups whose errors are HTML pages, and the only ones an interface's error page renders for. */
export type PageGroup = "app" | "profile" | "admin";
export const isPageGroup = (group: RouteGroup): group is PageGroup =>
  group === "app" || group === "profile" || group === "admin";

/**
 * An interface's error page (P1.25k; architecture record 2026-10-07-p125k-error-page-hook.md): the HTML body for an
 * error in a page group. Synchronous, and it gets only what the kit chooses: the shown code, the group, and for
 * `internal.error` the kit's own request id. No path, query, header, cookie or session reaches it, so an error body
 * cannot echo the caller. The kit keeps the status and every header.
 */
export type ErrorPage = (code: ErrorCode, ctx: { group: PageGroup; reqId?: string }) => string;

/** An error page body over this many bytes is refused, so a runaway render cannot inflate a response anyone can hit. */
const ERROR_PAGE_MAX_BYTES = 256 * 1024;
/** What the kit logs when the error page returns something other than a string within the limit. */
class ErrorPageRefused extends Error {
  override name = "ErrorPageRefused";
}

/** `errorPage` as errorResponse calls it: undefined, and one logged error, when it throws or gives no usable body. */
export function hookedPage(errorPage: ErrorPage, log: Pick<Logger, "logError">, reqId: string | undefined) {
  return (shown: ErrorCode, group: PageGroup): string | undefined => {
    try {
      const ctx = shown === "internal.error" && reqId !== undefined ? { group, reqId } : { group };
      const body: unknown = errorPage(shown, ctx);
      if (typeof body === "string" && Buffer.byteLength(body) <= ERROR_PAGE_MAX_BYTES) return body;
      throw new ErrorPageRefused("error page gave no string body within the limit");
    } catch (error) {
      log.logError(error);
      return undefined;
    }
  };
}

/** The fixed page with the code and a link home: the fallback when the interface has no error page or it fails. */
function errorPage(code: ErrorCode): string {
  const message = code in ERROR_MESSAGES ? ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><h1>${message}</h1><p>${code}</p><p><a href="/">Home</a></p></body></html>`;
}

/**
 * The response for `code` in `group`: HTML for pages, JSON for the API, an empty body for media and static. A page
 * group's body is `page(shown)` when that gives one, else the fixed page. A page 404 is `no-cache`: its body depends on
 * the group alone, so there is nothing per-user to keep (P1.25k record, point 2); every other error is `no-store`.
 */
export function errorResponse(
  code: ErrorCode,
  group: RouteGroup,
  headers: Record<string, string> = {},
  page?: (shown: ErrorCode, group: PageGroup) => string | undefined,
): Response {
  const shown: ErrorCode = ERROR_CODES[code].public ? code : "internal.error";
  const cache = shown === "http.not_found" && isPageGroup(group) ? "no-cache" : "no-store";
  const init = { status: ERROR_CODES[shown].status, headers: { "cache-control": cache, ...headers } };
  if (group === "api") return Response.json({ error: shown }, init);
  if (!isPageGroup(group)) return new Response(null, init);
  return new Response(page?.(shown, group) ?? errorPage(shown), {
    ...init,
    headers: { ...init.headers, "content-type": "text/html; charset=utf-8" },
  });
}
