// GET /.well-known/security.txt (P2.15; P1.20d; RFC 9116, https://www.rfc-editor.org/rfc/rfc9116.html, read
// 2026-10-17). The folder is `[x+2e]well-known`, SvelteKit's escape for a leading dot
// (https://svelte.dev/docs/kit/advanced-routing#Encoding), because the policy glob in route-table.ts skips dot folders. Group `static`: text needs no stylesheet. Built once from config on the first request; SvelteKit
// answers HEAD with this GET's headers and no body (https://svelte.dev/docs/kit/routing#server, kit 3.2.0).
import type { RequestHandler } from "@sveltejs/kit";
import { securityTxtDocument } from "../../../lib/server/legal.ts";
import { config } from "../../../lib/server/runtime.ts";

const HEADERS = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" };
let body: string | undefined;

export const GET: RequestHandler = () => {
  body ??= securityTxtDocument({
    origin: config.PUBLIC_ORIGIN,
    contact: config.SECURITY_CONTACT,
    expires: config.SECURITY_TXT_EXPIRES,
  });
  return new Response(body, { status: 200, headers: HEADERS });
};
