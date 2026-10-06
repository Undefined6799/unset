// The web server's page responses (P1.23; P1.22's documentPrefs wired in): the request's preferences and the parsed
// build go to apps/web's render entry as props, and the response carries the headers documentPrefs chose (app pages
// private and varying on Cookie; public pages neither, so their bytes never depend on a cookie).
import type { RouteGroup } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import type { IslandDefinition } from "@unset/shared-ui";
import type { ReactNode } from "react";
import { documentPrefs } from "../prefs/theme.ts";
import type { WebBuild } from "./build.ts";
import type { WebRender } from "./render-entry.ts";

export type PageDeps = Readonly<{
  build: WebBuild;
  /** apps/web's render: the server build in production, the source in tests (compose.ts). */
  render: WebRender["renderPage"];
  /** ASSETS_BASE's origin, or PUBLIC_ORIGIN's when ASSETS_BASE is empty. */
  assetsOrigin: string;
  env: "dev" | "test" | "prod";
  log: Logger;
  /** The island registry; tests pass their own, production uses every `*.island.tsx`. */
  islands?: ReadonlyMap<string, IslandDefinition>;
}>;

const ISLAND_ENV = { dev: "development", test: "test", prod: "production" } as const;

/** A full HTML page response for a route in `group`. */
export function pageResponse(
  deps: PageDeps,
  page: { group: RouteGroup; request: Request; title: string; body: ReactNode },
): Response {
  const prefs = documentPrefs(page.group, page.request.headers.get("cookie"));
  const { html, tooLarge } = deps.render({
    prefs,
    assets: { origin: deps.assetsOrigin, manifest: deps.build.manifest },
    env: ISLAND_ENV[deps.env],
    title: page.title,
    body: page.body,
    ...(deps.islands ? { islands: deps.islands } : {}),
  });
  // The name comes from the island registry the render looked it up in, never from the request.
  for (const island of tooLarge) deps.log.warn("island.props_too_large", { island });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", ...prefs.headers } });
}
