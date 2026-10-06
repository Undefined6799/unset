// The composition root of the web server (unset.sh) (P1.04; rules TE-1, AB-2): the only file that builds adapters.
// P1.23 reads apps/web's build once here; the same parse feeds the assets route and every page render.
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

export type Services = {
  server: ReturnType<typeof createServer>;
  /** Renders a page; the page routes (P1.25 onwards) call it. */
  page: (page: Parameters<typeof pageResponse>[1]) => Response;
};

const DEFAULT_WEB_BUILD = fileURLToPath(new URL("../../apps/web/dist/client/", import.meta.url));

export async function compose(cfg: Config<(typeof config)["fields"]>): Promise<Services> {
  const log = createLogger({ service: cfg.UNSET_SERVICE, commit: cfg.UNSET_COMMIT, env: cfg.UNSET_ENV });
  const build = loadWebBuild(cfg.WEB_BUILD_DIR === "" ? DEFAULT_WEB_BUILD : cfg.WEB_BUILD_DIR);
  const deps: PageDeps = {
    build,
    assetsOrigin: new URL(cfg.ASSETS_BASE === "" ? cfg.PUBLIC_ORIGIN : cfg.ASSETS_BASE).origin,
    env: cfg.UNSET_ENV,
    log,
  };
  const routes = [...prefsRoutes(), ...assetsRoutes(build.files)];
  return { server: createServer({ config: cfg, routes, policies, log }), page: (page) => pageResponse(deps, page) };
}
