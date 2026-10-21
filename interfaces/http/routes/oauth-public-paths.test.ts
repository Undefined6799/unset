// P1.36i: the client's two public OAuth paths on staging.unset.sh, pinned because P1.36b's 405 rule and P1.33p's probe
// name them (staging has no Pangolin login, ADR 0031 Decision 1). The app serves exactly the client's metadata URL and
// its jwks_uri, as clientMetadata builds them (infrastructure/pds/oauth/oauth-client.ts), and nothing else under
// either path answers without a session.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { clientMetadata, publicJwks, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { loadConfig } from "@unset/shared-config";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { webTestEnv } from "../test-env.ts";

const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const BUILD = fileURLToPath(new URL("../web/testdata/", import.meta.url));
const cfg = loadConfig(config, webTestEnv(SECRETS, { WEB_BUILD_DIR: BUILD }));
const { server } = await compose(cfg, web);
const metadata = clientMetadata(cfg.PUBLIC_ORIGIN, SCOPE_METADATA);
/** The paths the client's own metadata names: the two P1.36b's 405 rule and P1.33p's probe name. */
const PUBLIC = [new URL(metadata.client_id).pathname, new URL(metadata.jwks_uri).pathname];
/** What each path must answer through the composed router, so a broader route registered first cannot shadow it. */
const BODIES = [metadata, publicJwks(cfg.OAUTH_CLIENT_KEYS)];
const get = (path: string) =>
  server.request(
    new Request(`${cfg.PUBLIC_ORIGIN}${path}`, { headers: { host: new URL(cfg.PUBLIC_ORIGIN).host } }),
    "10.0.0.1",
  );
/** Whether `path` is one of the public paths or lies under one. */
const under = (path: string) => PUBLIC.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

describe("the public sign-in files (P1.36i)", () => {
  test("public_paths_are_the_clients_own", async () => {
    expect(PUBLIC).toEqual(["/oauth-client-metadata.json", "/oauth/jwks.json"]);
    for (const [i, path] of PUBLIC.entries()) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toBe("application/json");
      expect(await response.json(), path).toEqual(BODIES[i]);
    }
  });

  test("nothing_else_under_them_is_public", async () => {
    // The route table: under the two paths, only the two themselves need no session.
    const open = server.routeTable().filter((route) => under(route.path) && route.requiresSession !== true);
    expect(open.map((route) => `${route.method} ${route.path}`)).toEqual(PUBLIC.map((path) => `GET ${path}`));
    // And through the router: a deeper path, or a trailing slash, never answers a document.
    for (const path of PUBLIC.flatMap((p) => [`${p}/`, `${p}/x`, `${p}/..%2F`])) {
      const response = await get(path);
      expect(response.status, path).not.toBe(200);
      expect(response.headers.get("content-type") ?? "", path).not.toBe("application/json");
    }
  });
});
