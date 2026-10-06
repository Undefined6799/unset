// The composition root of the web server (unset.sh) (P1.04; rules TE-1, AB-2): the only file that builds adapters.
// P1.23 reads apps/web's build once here; the same parse feeds the assets route and every page render. P1.23c: the
// render is apps/web's server build, loaded once, unless the caller passes one. main.ts never does, so production
// runs only the build and its import graph holds no app source (architecture Amendment 2026-10-06 21:05Z); tests
// pass the source, which only Vitest can compile (it has import.meta.glob and CSS Modules).
import { fileURLToPath } from "node:url";
import type { Config } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import type { config } from "./config.ts";
import { policies } from "./limits.ts";
import { assetsRoutes } from "./routes/assets.ts";
import { prefsRoutes } from "./routes/prefs.ts";
import { loadWebBuild } from "./web/build.ts";
import { type PageDeps, pageResponse } from "./web/page.ts";
import { loadWebRender, type WebRender } from "./web/render-entry.ts";

export type Services = {
  server: ReturnType<typeof createServer>;
  /** Renders a page; the page routes (P1.25 onwards) call it. */
  page: (page: Parameters<typeof pageResponse>[1]) => Response;
};

const DEFAULT_WEB_BUILD = fileURLToPath(new URL("../../apps/web/dist/client/", import.meta.url));
export async function compose(cfg: Config<(typeof config)["fields"]>, web?: WebRender): Promise<Services> {
  const log = createLogger({ service: cfg.UNSET_SERVICE, commit: cfg.UNSET_COMMIT, env: cfg.UNSET_ENV });
  const render = web ?? (await loadWebRender());
  const build = loadWebBuild(cfg.WEB_BUILD_DIR === "" ? DEFAULT_WEB_BUILD : cfg.WEB_BUILD_DIR, render.islandName);
  const deps: PageDeps = {
    build,
    render: render.renderPage,
    assetsOrigin: new URL(cfg.ASSETS_BASE === "" ? cfg.PUBLIC_ORIGIN : cfg.ASSETS_BASE).origin,
    env: cfg.UNSET_ENV,
    log,
  };
  const routes = [...prefsRoutes(), ...assetsRoutes(build.files)];
  return { server: createServer({ config: cfg, routes, policies, log }), page: (page) => pageResponse(deps, page) };
}
