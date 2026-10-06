// GET /assets/<file> (P1.23; plan §5.1; architecture ruling 2026-10-06, 2026-10-06-p123-islands-runtime-placement.md):
// serves apps/web's built files and nothing else. The request is looked up by exact name in the map the manifest
// built at startup; it is never joined to a directory, so `..`, encoded slashes and absolute paths reach no file.
// HEAD is the kit's (it runs GET and drops the body); the kit's security headers stay as they are.
import { readFile } from "node:fs/promises";
import { defineRoute, errorResponse, type Route } from "@unset/shared-http";

/** The only types served, by extension; any other extension is not served. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: "text/javascript",
  css: "text/css",
  woff2: "font/woff2",
  svg: "image/svg+xml",
  png: "image/png",
};
const PATH = /^\/assets\/([A-Za-z0-9._-]+)$/;

function notFound(): Response {
  const response = errorResponse("http.not_found", "static");
  response.headers.set("cache-control", "no-cache");
  return response;
}

export const assetsRoutes = (files: ReadonlyMap<string, string>): Route[] => [
  defineRoute({
    method: "GET",
    path: "/assets/:file",
    group: "static",
    rateLimit: "exempt",
    session: "none",
    handler: async ({ request }) => {
      const name = PATH.exec(new URL(request.url).pathname)?.[1];
      const path = name === undefined ? undefined : files.get(name);
      const type = name === undefined ? undefined : CONTENT_TYPES[name.slice(name.lastIndexOf(".") + 1)];
      if (path === undefined || type === undefined) return notFound();
      return new Response(await readFile(path), {
        headers: {
          "content-type": type,
          // Every built name carries its content hash, so its bytes never change; they carry no personal data.
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
        },
      });
    },
  }),
];
