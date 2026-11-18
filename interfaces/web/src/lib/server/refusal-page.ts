// The page a browser gets when the gate refuses a request before any route runs (P1.20k): a limit, the deadline, a
// body the route does not take, a route with no policy. interfaces/http rendered its error page for every error
// (shared/http/errors.ts errorPageHook); SvelteKit renders +error.svelte only for errors a route throws, so the gate
// answers a request that asks for HTML with this page and every other request with the code as text, as before. The
// page shows only the catalog's text and code: nothing from the request reaches it. On an app or public route it links
// the build's stylesheet, whose path server.ts read once from the build manifest, so it looks like the error page;
// the hook sends it under the public policy, which allows /_app/ styles and /fonts/ and no script. On any other
// route, or with no stylesheet, it loads nothing, so the static group's `default-src 'none'` holds.
import { ERROR_MESSAGES } from "@unset/shared-errors";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Whether a refusal should be the page: a document request from a browser, not SvelteKit's data or action calls. */
export function wantsPage(request: Request, dataRequest: boolean): boolean {
  if (dataRequest || request.headers.has("x-sveltekit-action")) return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** The refusal page for `code`, with the refusal's status and headers, styled when given the build's stylesheet. */
export function refusalPage(code: string, status: number, headers: Headers, stylesheet?: string): Response {
  const text = ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code;
  const style = stylesheet === undefined ? "" : `\n    <link rel="stylesheet" href="${escapeHtml(stylesheet)}" />`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(text)}</title>${style}
  </head>
  <body>
    <main id="main" class="mx-auto w-full max-w-3xl px-4 py-8">
      <h1>${escapeHtml(text)}</h1>
      <p>Error code <code>${escapeHtml(code)}</code></p>
      <p><a href="/">Go to the home page</a></p>
    </main>
  </body>
</html>
`;
  const out = new Headers(headers);
  out.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status, headers: out });
}
