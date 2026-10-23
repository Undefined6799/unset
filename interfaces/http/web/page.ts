// The web server's page responses (P1.23; P1.22's documentPrefs wired in): the request's preferences and the parsed
// build go to apps/web's render entry as props, and the response carries the headers documentPrefs chose (app pages
// private and varying on Cookie; public pages neither, so their bytes never depend on a cookie).
// P1.25: a page may ask for the app shell, which shows a checked `?error=` code; and the kit's error-page hook renders
// every error page through the same shell, anonymously and with no script.
// P1.25f: an app page gets the footer's theme form (only the default shell has a footer), preset to the page's theme
// and returning to the page's path. Only the path goes back, never the query, so no request text is echoed into it;
// P2.13d: on the two sign-in pages a rebuilt, re-checked next and handle go back too (prefs/return-to.ts).
// A feed page asks for `feed`, which drops the footer.
import type { ShellOptions } from "@unset/apps-web";
import { ERROR_MESSAGES, readErrorParam } from "@unset/shared-errors";
import type { ErrorPage, RouteGroup } from "@unset/shared-http";
import type { IslandDefinition } from "@unset/shared-islands";
import type { Logger } from "@unset/shared-log";
import type { ReactNode } from "react";
import { pageReturnTo } from "../prefs/return-to.ts";
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

/** What a route asks for. `islands: "off"` is written in the route itself, never chosen from the request. */
export type PageSpec = {
  group: RouteGroup;
  request: Request;
  title: string;
  body: ReactNode;
  islands?: "off";
  /** Load the owner's README editor entry (ADR 0037 point 5); written in its one route. */
  editor?: true;
  /** Render inside the app shell; `noindex` also sends `X-Robots-Tag`. */
  shell?: { noindex?: true; navigation?: ShellOptions["navigation"]; feed?: true };
};

const ISLAND_ENV = { dev: "development", test: "test", prod: "production" } as const;

/** The render input every page shares: the build's assets, the island environment and registry. */
const renderBase = (deps: PageDeps) => ({
  assets: { origin: deps.assetsOrigin, manifest: deps.build.manifest },
  env: ISLAND_ENV[deps.env],
  ...(deps.islands ? { registry: deps.islands } : {}),
});

/** A full HTML page response for a route in `group`. */
export function pageResponse(deps: PageDeps, page: PageSpec): Response {
  const prefs = documentPrefs(page.group, page.request.headers.get("cookie"));
  const noindex = page.shell?.noindex === true;
  const url = new URL(page.request.url);
  const footerPrefs =
    page.group === "app"
      ? { theme: prefs.htmlAttrs["data-theme"] ?? ("system" as const), returnTo: pageReturnTo(url) }
      : undefined;
  const shell = page.shell && {
    error: readErrorParam(url.searchParams),
    noindex,
    ...(page.shell.navigation === undefined ? {} : { navigation: page.shell.navigation }),
    ...(page.shell.feed === undefined ? {} : { feed: page.shell.feed }),
    ...(footerPrefs === undefined ? {} : { prefs: footerPrefs }),
  };
  const { html, tooLarge } = deps.render({
    ...renderBase(deps),
    prefs,
    title: page.title,
    body: page.body,
    islands: page.islands ?? "on",
    ...(shell ? { shell } : {}),
    ...(page.editor ? { editor: true as const } : {}),
  });
  // The name comes from the island registry the render looked it up in, never from the request.
  for (const island of tooLarge) deps.log.warn("island.props_too_large", { island });
  const headers = { "content-type": "text/html; charset=utf-8", ...prefs.headers };
  return new Response(html, { headers: noindex ? { ...headers, "x-robots-tag": "noindex" } : headers });
}

/**
 * The kit's error-page hook (P1.25k): the shell around apps/web's error page, with no script. The kit passes only
 * the shown code and, for internal.error, its request id, so the page is the same for every caller: public prefs,
 * as with no cookie, and no `?error=`. The kit keeps the status and every header; if this throws, it uses its own page.
 */
export function errorPageHook(deps: PageDeps, screens: WebRender["screens"]): ErrorPage {
  return (code, { reqId }) =>
    deps.render({
      ...renderBase(deps),
      prefs: documentPrefs("public", null),
      title: ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code,
      body: screens.errorPage(reqId === undefined ? { code } : { code, reqId }),
      islands: "off",
      shell: { error: null, noindex: false },
    }).html;
}
