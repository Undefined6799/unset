// GET /.well-known/security.txt (P2.15; RFC 9116, read 2026-10-17, https://www.rfc-editor.org/rfc/rfc9116.html).
// Group `static`: the body is text, so it needs no stylesheet. The text is built once at boot from config.
import { defineRoute, type Route } from "@unset/shared-http";
import { securityTxtDocument } from "../security-txt.ts";

const HEADERS = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" };

export const securityTxtRoutes = (input: { origin: string; contact: string; expires: string }): Route[] => {
  const body = securityTxtDocument(input);
  return [
    defineRoute({
      method: "GET",
      path: "/.well-known/security.txt",
      group: "static",
      rateLimit: "default",
      session: "none",
      handler: () => new Response(body, { status: 200, headers: HEADERS }),
    }),
  ];
};
