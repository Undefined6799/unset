// The security headers (P1.08) through the server kit: every response, error pages included, carries its group's set.
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import type { HttpKitConfig } from "../config.ts";
import { defineRoute } from "../routes.ts";
import { createServer } from "../server.ts";
import { securityHeaders } from "./headers.ts";

const CONFIG: HttpKitConfig = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "http",
  UNSET_COMMIT: "c".repeat(40),
  LISTEN_PORT: 8080,
  PUBLIC_ORIGIN: "https://unset.test",
  HTTP_ALLOWED_HOSTS: ["unset.test"],
  SHUTDOWN_GRACE_MS: 1000,
  REQUEST_DEADLINE_MS: 30000,
  TRUSTED_PROXY_MODE: "socket",
  TRUSTED_PROXY_HEADER: "",
  TRUSTED_PROXY_CIDRS: [],
  TRUSTED_PROXY_HOPS: 1,
  HTTP_BODY_LIMIT_BYTES: 1024,
  RATE_LIMIT_MAX_KEYS: 100_000,
  MEDIA_ORIGIN: "https://unset-media.test",
  ASSETS_BASE: "",
  DEV_VITE_ORIGIN: "",
};
const POLICIES = {
  default: [{ capacity: 10_000, refillPerSec: 100, scope: "ip" }],
  once: [{ capacity: 1, refillPerSec: 0.001, scope: "ip" }],
} as const;
const csp = (group: Parameters<typeof securityHeaders>[0]) => securityHeaders(group, CONFIG)["content-security-policy"];

function kit() {
  const lines: string[] = [];
  const get = (path: string, handler: () => Response, rateLimit = "default") =>
    defineRoute({ method: "GET", path, group: "app", rateLimit, session: "none", handler });
  const server = createServer({
    config: CONFIG,
    routes: [
      get("/ok", () => new Response("ok")),
      get("/once", () => new Response("ok"), "once"),
      get("/boom", () => {
        throw new Error("boom");
      }),
      get("/own-csp", () => new Response("ok", { headers: { "content-security-policy": "default-src *" } })),
      get("/frozen", () => Response.redirect("https://unset.test/ok", 303)),
      get("/spent", () => {
        const spent = new Response("x");
        void spent.body?.getReader(); // a locked body cannot be copied, so securing it throws
        return spent;
      }),
      defineRoute({
        method: "POST",
        path: "/form",
        group: "app",
        rateLimit: "default",
        session: "none",
        handler: () => new Response("ok"),
      }),
    ],
    policies: POLICIES,
    log: createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: (l) => lines.push(l) }),
  });
  const send = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    server.request(
      new Request(`http://internal${path}`, { ...init, headers: { host: "unset.test", ...init.headers } }),
      "203.0.113.7",
    );
  const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { send, server, events };
}

const post = (body: string, type = "application/x-www-form-urlencoded") => ({
  method: "POST",
  headers: { "content-type": type, "content-length": String(body.length), "sec-fetch-site": "same-origin" },
  body,
});

describe("security headers", () => {
  test("error_pages_use_group_csp", async () => {
    const { send } = kit();
    const scriptHandle = await send("/@%3Cscript%3E");
    expect(scriptHandle.status).toBe(404);
    expect(scriptHandle.headers.get("content-security-policy")).toBe(csp("profile"));
    const nope = await send("/nope");
    expect(nope.status).toBe(404);
    expect(nope.headers.get("content-security-policy")).toBe(csp("app"));
    const big = await send("/form", post("a=".padEnd(2048, "x")));
    expect(big.status).toBe(413);
    expect(big.headers.get("content-security-policy")).toBe(csp("app"));
    const health = await send("/health");
    expect(health.headers.get("content-security-policy")).toBe(csp("static"));
  });

  test("headers_on_every_response", async () => {
    const { send } = kit();
    await send("/once");
    const responses = {
      200: await send("/ok"),
      400: await send("/ok", { headers: { host: "" } }),
      404: await send("/nope"),
      405: await send("/ok", { method: "PUT" }),
      415: await send("/form", post("{}", "application/json")),
      429: await send("/once"),
      500: await send("/boom"),
    };
    for (const [status, response] of Object.entries(responses)) {
      expect(response.status, status).toBe(Number(status));
      for (const name of ["content-security-policy", "strict-transport-security", "referrer-policy"]) {
        expect(response.headers.get(name), `${status} ${name}`).toBeTruthy();
      }
      expect(response.headers.get("x-content-type-options"), status).toBe("nosniff");
      expect(response.headers.get("x-frame-options"), status).toBe("DENY");
    }
    const head = await send("/ok", { method: "HEAD" });
    expect(head.headers.get("content-security-policy")).toBe(csp("app"));
  });

  test("handler_cannot_override", async () => {
    const { send, events } = kit();
    const response = await send("/own-csp");
    expect(response.headers.get("content-security-policy")).toBe(csp("app"));
    expect(events()).toContainEqual(expect.objectContaining({ event: "csp.handler_override", route: "/own-csp" }));
  });

  test("headers_failure_uses_static_set", async () => {
    // Step "an exception inside the headers middleware": the most restrictive set, on a 500.
    const { send } = kit();
    const response = await send("/spent");
    expect(response.status).toBe(500);
    expect(response.headers.get("content-security-policy")).toBe(csp("static"));
  });

  test("immutable_handler_response_still_secured", async () => {
    // Response.redirect's headers are immutable; the kit copies the response before setting its own.
    const { send } = kit();
    const response = await send("/frozen");
    expect(response.status).toBe(303);
    expect(response.headers.get("content-security-policy")).toBe(csp("app"));
  });
});
