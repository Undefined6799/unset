// The composition root of the upload review service (a health-only server until its checks land) (P1.04; rules TE-1, AB-2): the only file that builds adapters. In this step it
// wires only the server kit; later steps add their adapters here.
import type { Config } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import type { config } from "./config.ts";

export type Services = { server: ReturnType<typeof createServer> };

export async function compose(cfg: Config<(typeof config)["fields"]>): Promise<Services> {
  const log = createLogger({ service: cfg.UNSET_SERVICE, commit: cfg.UNSET_COMMIT, env: cfg.UNSET_ENV });
  return { server: createServer({ config: cfg, routes: [], policies: {}, log }) };
}
