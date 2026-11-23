// P1.20k, ported from shared/http/csrf/coverage.test.ts (P1.07 steps 9 and 10) for the SvelteKit server. Every route
// file that can write takes it as a POST (a form action or a POST handler; nothing else takes PUT, PATCH or DELETE), and
// on the built server every one of them refuses a cross-site post and a post with no Origin, whatever the body type,
// before any action runs: SvelteKit's Origin check for the form types (kit 3.2.0 src/runtime/server/respond.js), and
// the gate's form-only rule for every other type (hooks.server.ts FORM_TYPES). The routes that answer a GET with a
// handler of their own are a fixed list; the one that changes state is the OAuth callback, protected by its state and
// nonce, not by an Origin check (as shared/http/csrf/exceptions.ts listed it).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, type RunningWeb, startWeb } from "./built-server.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const ROUTES = join(REPO, "interfaces", "web", "src", "routes");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

/** A route folder as a request path: a parameter takes a value its matcher accepts, `[x+2e]` is a dot. */
function pathOf(folder: string): string {
  const path = folder
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
    .map((segment) =>
      segment
        .replace("[did=did]", `did:plc:${"c".repeat(24)}`)
        .replace("[document=legal]", "terms")
        .replace("[key]", "abc")
        .replace("[x+2e]", "."),
    )
    .join("/");
  return `/${path}`;
}

type RouteFile = { file: string; path: string; source: string };
const ROUTE_FILES: RouteFile[] = readdirSync(ROUTES, { recursive: true, encoding: "utf8" })
  .filter((file) => /(^|\/)\+(server|page\.server)\.ts$/.test(file))
  .sort()
  .map((file) => ({
    file,
    path: pathOf(file.slice(0, file.lastIndexOf("/") + 1)),
    source: readFileSync(join(ROUTES, file), "utf8"),
  }));
const exports = (source: string, name: string) =>
  new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${name}\\b`).test(source);
const writers = ROUTE_FILES.filter((route) => exports(route.source, "actions") || exports(route.source, "POST"));

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  web = await startWeb(pg);
}, 120_000);
afterAll(async () => {
  await web?.stop();
});

describe("csrf coverage", () => {
  test("every_write_is_a_post", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(20);
    expect(writers.length).toBeGreaterThan(10);
    for (const route of ROUTE_FILES) {
      for (const method of ["PUT", "PATCH", "DELETE", "fallback"]) {
        expect(exports(route.source, method), `${route.file} ${method}`).toBe(false);
      }
    }
  });

  test("every_route_that_writes_refuses_a_post_from_another_site_or_from_nowhere", async () => {
    const bodies = [
      { type: "application/x-www-form-urlencoded", body: "a=1" },
      {
        type: "multipart/form-data; boundary=x",
        body: '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--x--\r\n',
      },
      { type: "text/plain", body: "a=1" },
      { type: "application/json", body: '{"a":1}' },
    ];
    for (const route of writers) {
      const target = exports(route.source, "actions") ? `${route.path}?/x` : route.path;
      for (const origin of ["https://evil.test", undefined]) {
        for (const { type, body } of bodies) {
          const response = await web.fetch(target, {
            method: "POST",
            body,
            headers: {
              "x-forwarded-for": clientAddress(),
              "content-type": type,
              ...(origin === undefined ? {} : { origin }),
            },
          });
          const label = `${route.file} ${origin ?? "no origin"} ${type}`;
          expect([403, 415], label).toContain(response.status);
          await response.body?.cancel();
        }
      }
    }
  });

  test("a_refused_post_never_reaches_its_action", async () => {
    // The test route's action fails loudly (500) if it ever runs without a session; a cross-site post gets 403.
    const response = await web.fetch("/test-routes/writes/abc?/save", {
      method: "POST",
      body: "x=1",
      headers: {
        "x-forwarded-for": clientAddress(),
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.test",
      },
    });
    expect(response.status).toBe(403);
    expect(web.logs().filter((line) => line.level === "error")).toEqual([]);
  });

  test("only_these_routes_answer_a_get_with_their_own_handler", () => {
    // A GET is never under the Origin check, so a handler that changes state on one is a security-reviewed change:
    // a new entry here is one. The OAuth callback consumes the login nonce, stores the sealed token set and creates the
    // session (P2.06), protected by the state and __Host- nonce binding, single-use (plan §2 rule 2). robots.txt and the sitemap only read (ADR 0062).
    const gets = ROUTE_FILES.filter((route) => exports(route.source, "GET")).map((route) => route.path);
    // The unset.cc sign-in hop (build step 5) writes nothing: it signs a ticket bound to the one-time value the door
    // set in this browser, and sends it only to the configured door, so a cross-site link signs nobody in (ADR 0093).
    // The chat icon's count (ADR 0115) only reads.
    expect(gets).toEqual([
      "/.well-known/security.txt",
      "/chat/count",
      "/chat/sign-in",
      "/fonts/JetBrainsMono-Variable.woff2",
      "/fonts/SpaceGrotesk-Variable.woff2",
      "/health",
      "/me",
      "/oauth-client-metadata.json",
      "/oauth/callback",
      "/oauth/jwks.json",
      "/robots.txt",
      "/settings",
      "/sitemap.xml",
      "/test-routes/fails",
      "/test-routes/waits",
    ]);
  });
});
