// SE-4 (#1279): the manifest says which routes need a signed-in session, and the handlers agree. The kit records
// `session: "handler"` without enforcing it (shared/http/routes.ts), so this calls every route of the composed server
// signed out and checks that exactly the declared routes send the browser to sign in. A route that only peeks at the
// session (/login, POST /logout, /signed-out) answers something else and stays undeclared.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { loadConfig } from "@unset/shared-config";
import type { RouteInfo } from "@unset/shared-http";
import { afterAll, expect, test } from "vitest";
import { compose } from "./compose.ts";
import { config } from "./config.ts";
import { webTestEnv } from "./test-env.ts";

const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const cfg = loadConfig(
  config,
  webTestEnv(SECRETS, { WEB_BUILD_DIR: fileURLToPath(new URL("./web/testdata/", import.meta.url)) }),
);
const { server } = await compose(cfg, web);

/** A well-formed value per path parameter, so a gate is reached before any not-found; an unknown name fails. */
const SAMPLE: Readonly<Record<string, string>> = { did: `did:plc:${"a".repeat(24)}`, file: "app.js" };
const pathOf = (template: string): string =>
  template.replace(/:(\w+)/g, (_, name: string) => {
    const value = SAMPLE[name];
    if (value === undefined) throw new Error(`${template}: no sample value for :${name}`);
    return value;
  });

/** One signed-out request: no cookie, a same-origin form POST with an empty body, and its own client address. */
async function signedOut(route: RouteInfo, n: number): Promise<Response> {
  const post = route.method === "POST";
  const headers: Record<string, string> = {
    host: new URL(cfg.PUBLIC_ORIGIN).host,
    "x-forwarded-for": `198.51.100.${n}`,
  };
  if (post) Object.assign(headers, { origin: cfg.PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" });
  const request = new Request(`${cfg.PUBLIC_ORIGIN}${pathOf(route.path)}`, {
    method: route.method,
    headers,
    ...(post ? { body: "" } : {}),
  });
  return server.request(request, "10.0.0.1");
}

/** Whether the answer is the sign-in redirect: a 303 to /login that carries a return path and no error. */
function sendsToSignIn(response: Response): boolean {
  const location = response.headers.get("location");
  if (response.status !== 303 || location === null) return false;
  const target = new URL(location, cfg.PUBLIC_ORIGIN);
  return target.pathname === "/login" && target.searchParams.has("next") && !target.searchParams.has("error");
}

test("declared_session_matches_the_handler", async () => {
  const routes = server.routeTable();
  const drift: string[] = [];
  for (const [i, route] of routes.entries()) {
    const gated = sendsToSignIn(await signedOut(route, i + 1));
    if (gated !== (route.handlerSession === true)) {
      drift.push(`${route.method} ${route.path}: ${gated ? "sends to sign-in, not declared" : "declared, not gated"}`);
    }
  }
  expect(drift).toEqual([]);
  // Not vacuous: the routes P2's authorization exit test selects (mutating, session needed) are found.
  const mutating = routes.filter((route) => route.mutates && route.handlerSession === true);
  expect(mutating.map((route) => `${route.method} ${route.path}`)).toEqual([
    "POST /welcome/age",
    "POST /welcome/terms",
    "POST /welcome/chat",
    "POST /verify-email/reconsent",
  ]);
});
