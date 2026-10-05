// P1.07 static coverage: every POST route lists the gate after bodyLimit and is denied cross-site, and no GET or HEAD
// route changes state unless GET_MUTATION_EXCEPTIONS lists it. The "no raw Hono routes" half of step 9 is the
// route-registration guard (P1.04q, scripts/guards/route-registration.ts), which already runs on every check.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import type { HttpKitConfig } from "../config.ts";
import { defineRoute, type RouteGroup } from "../routes.ts";
import { createServer, type RouteInfo } from "../server.ts";
import { GET_MUTATION_EXCEPTIONS } from "./exceptions.ts";

const INTERFACES = join(import.meta.dirname, "..", "..", "..", "interfaces");
const CONFIG: HttpKitConfig = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "http",
  UNSET_COMMIT: "c".repeat(40),
  LISTEN_PORT: 8080,
  PUBLIC_ORIGIN: "https://unset.sh",
  HTTP_ALLOWED_HOSTS: ["unset.sh"],
  SHUTDOWN_GRACE_MS: 1000,
  REQUEST_DEADLINE_MS: 30000,
  TRUSTED_PROXY_MODE: "socket",
  TRUSTED_PROXY_HEADER: "",
  TRUSTED_PROXY_CIDRS: [],
  TRUSTED_PROXY_HOPS: 1,
  HTTP_BODY_LIMIT_BYTES: 65_536,
  RATE_LIMIT_MAX_KEYS: 100_000,
};
const GROUPS: readonly RouteGroup[] = ["app", "profile", "media", "admin", "api"];

/** Each interface's committed route table (kept fresh by its routes.manifest.test.ts, F-27). */
function manifests(): [string, RouteInfo[]][] {
  return readdirSync(INTERFACES)
    .filter((name) => existsSync(join(INTERFACES, name, "routes.manifest.json")))
    .map((name) => [name, JSON.parse(readFileSync(join(INTERFACES, name, "routes.manifest.json"), "utf8"))]);
}

const gatedAfterBodyLimit = (route: Pick<RouteInfo, "middleware">) => {
  const csrf = route.middleware.indexOf("csrf");
  return csrf > route.middleware.indexOf("bodyLimit") && route.middleware.indexOf("bodyLimit") >= 0;
};

describe("csrf coverage", () => {
  test("every_post_route_gated", async () => {
    const tables = manifests();
    expect(tables.length).toBeGreaterThan(0);
    for (const [name, routes] of tables) {
      for (const route of routes.filter((r) => r.method === "POST")) {
        expect(gatedAfterBodyLimit(route), `${name} POST ${route.path}`).toBe(true);
      }
    }
    // The same over a kit server with a POST route in every group: listed, and a cross-site POST never runs it.
    const called: string[] = [];
    const routes = GROUPS.map((group) =>
      defineRoute({
        method: "POST",
        path: `/${group}`,
        group,
        rateLimit: "default",
        session: "none",
        handler: () => {
          called.push(group);
          return new Response("ok");
        },
      }),
    );
    const server = createServer({
      config: CONFIG,
      routes,
      policies: { default: [{ capacity: 1000, refillPerSec: 10, scope: "ip" }] },
      log: createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined }),
    });
    for (const route of server.routeTable().filter((r) => r.method === "POST")) {
      expect(gatedAfterBodyLimit(route), route.path).toBe(true);
      const response = await server.request(
        new Request(`http://internal${route.path}`, {
          method: "POST",
          headers: {
            host: "unset.sh",
            "content-type": "application/x-www-form-urlencoded",
            "sec-fetch-site": "cross-site",
          },
          body: "a=1",
        }),
        "203.0.113.7",
      );
      expect(response.status, route.path).toBe(403);
    }
    expect(called).toEqual([]);
  });

  test("get_cannot_mutate", () => {
    const spec = { path: "/x", group: "app", rateLimit: "page", session: "none", mutates: true } as const;
    const handler = () => new Response("ok");
    expect(() => defineRoute({ ...spec, method: "GET", handler })).toThrow(/cannot mutate/);
    expect(() => defineRoute({ ...spec, method: "HEAD", handler })).toThrow(/cannot mutate/);
    expect(defineRoute({ ...spec, path: "/oauth/callback", method: "GET", handler }).mutates).toBe(true);
  });

  test("only_listed_get_routes_mutate", () => {
    expect(GET_MUTATION_EXCEPTIONS.map((e) => e.path)).toEqual(["/oauth/callback"]);
    for (const entry of GET_MUTATION_EXCEPTIONS) {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.protection.trim()).not.toBe("");
    }
    const listed = new Set(GET_MUTATION_EXCEPTIONS.map((e) => e.path));
    for (const [name, routes] of manifests()) {
      const mutatingGets = routes.filter((r) => r.method !== "POST" && r.mutates).map((r) => r.path);
      expect(
        mutatingGets.filter((path) => !listed.has(path)),
        name,
      ).toEqual([]);
    }
  });
});
