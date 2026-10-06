// Production serving: the client build's assets under /assets/, then the app.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

export function serveBuilt(server: Hono, app: Hono, port: number): void {
  server.use("/assets/*", serveStatic({ root: new URL("../client", import.meta.url).pathname }));
  server.route("/", app);
  serve({ fetch: server.fetch, port });
}
