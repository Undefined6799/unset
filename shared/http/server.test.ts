// The server kit against in-process requests (P1.04k; the P1.04 test list except the two that need entrypoints).
import { AppError } from "@unset/shared-errors";
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import type { HttpKitConfig } from "./config.ts";
import { defineRoute, type RouteSpec } from "./routes.ts";
import { createServer, type ServerOptions } from "./server.ts";

const COMMIT = "c".repeat(40);
const CONFIG: HttpKitConfig = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "http",
  UNSET_COMMIT: COMMIT,
  LISTEN_PORT: 8080,
  PUBLIC_ORIGIN: "https://unset.test",
  HTTP_ALLOWED_HOSTS: ["unset.test", ".0x40.me"],
  SHUTDOWN_GRACE_MS: 1000,
  REQUEST_DEADLINE_MS: 30000,
  TRUSTED_PROXY_MODE: "header",
  TRUSTED_PROXY_HEADER: "x-forwarded-for",
  TRUSTED_PROXY_CIDRS: ["10.0.0.0/8"],
  TRUSTED_PROXY_HOPS: 1,
  HTTP_BODY_LIMIT_BYTES: 65_536,
  RATE_LIMIT_MAX_KEYS: 100_000,
};
/** Room for every test's requests; the limits tests below set their own. */
const POLICIES = {
  default: [{ capacity: 10_000, refillPerSec: 100, scope: "ip" }],
  page: [{ capacity: 10_000, refillPerSec: 100, scope: "ip" }],
} as const;

const ok = () => new Response("ok");
const page = (spec: Partial<RouteSpec> & Pick<RouteSpec, "method" | "path">) =>
  defineRoute({ group: "app", rateLimit: "page", handler: ok, ...spec });

function kit(options: Partial<ServerOptions> = {}) {
  const lines: string[] = [];
  const log = createLogger({ service: "http", commit: COMMIT, env: "test", write: (line) => lines.push(line) });
  const server = createServer({
    config: CONFIG,
    routes: [page({ method: "GET", path: "/" }), page({ method: "POST", path: "/form" })],
    policies: POLICIES,
    log,
    ...options,
  });
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const request = (path: string, init: RequestInit & { host?: string; peer?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.host !== "") headers.set("host", init.host ?? "unset.test");
    return server.request(new Request(`http://internal${path}`, { ...init, headers }), init.peer);
  };
  return { server, request, lines, records };
}

describe("health", () => {
  test("health_ok_with_commit", async () => {
    const { request } = kit();
    const response = await request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", service: "http", commit: COMMIT });
  });

  test("health_unready", async () => {
    const no = kit({ readiness: [async () => false] });
    const unready = await no.request("/health");
    expect(unready.status).toBe(503);
    expect(((await unready.json()) as { status: string }).status).toBe("starting");
    const throws = kit({
      readiness: [
        async () => {
          throw new Error("db down");
        },
      ],
    });
    expect((await throws.request("/health")).status).toBe(503);
  });

  test("health_unready_after_ready", async () => {
    let ready = true;
    const { request } = kit({
      readiness: [async () => ready],
      now: (() => {
        let t = 0;
        return () => (t += 5000);
      })(),
    });
    expect((await request("/health")).status).toBe(200);
    ready = false;
    const response = await request("/health");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { status: string }).status).toBe("unready");
  });

  test("health_any_host", async () => {
    const { request } = kit();
    expect((await request("/health", { host: "localhost:8080" })).status).toBe(200);
  });
});

describe("request checks", () => {
  test("unknown_host_421", async () => {
    const { server, request } = kit({ routes: [page({ method: "GET", path: "/@:handle" })] });
    expect(server).toBeDefined();
    expect((await request("/@x", { host: "evil.example" })).status).toBe(421);
    expect((await request("/@x", { host: "a.b.0x40.me" })).status).toBe(421);
    expect((await request("/@x", { host: "alice.0x40.me" })).status).toBe(200);
    expect((await request("/@x", { host: "ALICE.0x40.me:443" })).status).toBe(200);
    expect((await request("/@x", { host: "alice.0x40.me:8443" })).status).toBe(421);
  });

  test("missing_host_400", async () => {
    const { request } = kit();
    expect((await request("/", { host: "" })).status).toBe(400);
  });

  test("method_put_405", async () => {
    const { request } = kit();
    const response = await request("/health", { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
  });

  test("method_mismatch_405", async () => {
    const { request } = kit();
    const response = await request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  test("head_on_get_route", async () => {
    const { request } = kit();
    const response = await request("/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  test("content_type_415", async () => {
    const { request } = kit();
    const json = await request("/form", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(json.status).toBe(415);
    const none = await request("/form", { method: "POST", body: new Uint8Array([1]) });
    expect(none.status).toBe(415);
    const form = await request("/form", {
      method: "POST",
      headers: { "content-type": "Application/X-WWW-Form-Urlencoded; charset=utf-8" },
      body: "a=1",
    });
    expect(form.status).toBe(200);
  });

  test("not_found_404_no_reflection", async () => {
    const { request } = kit();
    const response = await request("/x%3Cscript%3E");
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("%3Cscript");
    expect(body).toContain("http.not_found");
  });

  test("bad_percent_encoding_400", async () => {
    const { request } = kit();
    expect((await request("/%E0%A4%A")).status).toBe(400);
    expect((await request("/a%00b")).status).toBe(400);
  });

  test("errors_render_by_group", async () => {
    const { request } = kit({
      routes: [
        defineRoute({
          method: "GET",
          path: "/api/x",
          group: "api",
          rateLimit: "page",
          handler: () => {
            throw new AppError("http.not_found");
          },
        }),
        defineRoute({
          method: "GET",
          path: "/media/x",
          group: "media",
          rateLimit: "page",
          handler: () => {
            throw new AppError("http.not_found");
          },
        }),
      ],
    });
    const api = await request("/api/x");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "http.not_found" });
    const media = await request("/media/x");
    expect(media.status).toBe(404);
    expect(await media.text()).toBe("");
    const html = await request("/nothing-here");
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  test("error_hides_exception", async () => {
    const { request, lines } = kit({
      routes: [
        page({
          method: "GET",
          path: "/boom",
          handler: () => {
            throw new Error("db password xyz");
          },
        }),
      ],
    });
    const response = await request("/boom");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("xyz");
    expect(lines.join("")).not.toContain("xyz");
    expect(lines.join("")).toContain("internal.error");
  });

  test("request_log_uses_template", async () => {
    const { request, records } = kit({ routes: [page({ method: "GET", path: "/@:handle" })] });
    await request("/@alice");
    const line = records().find((r) => r.event === "http.request");
    expect(line).toMatchObject({ route: "/@:handle", method: "GET", status: 200 });
    expect(typeof line?.reqId).toBe("string");
    expect(JSON.stringify(records())).not.toContain("alice");
  });

  test("params_are_decoded", async () => {
    let seen = "";
    const { request } = kit({
      routes: [
        page({
          method: "GET",
          path: "/@:handle",
          handler: ({ params }) => {
            seen = params.handle ?? "";
            return ok();
          },
        }),
      ],
    });
    await request("/@al%69ce.test");
    expect(seen).toBe("alice.test");
  });
});

describe("deadline", () => {
  test("request_deadline_503", async () => {
    let sawAbort = false;
    const { request, records } = kit({
      routes: [
        page({
          method: "GET",
          path: "/slow",
          deadlineMs: 1000,
          handler: ({ deadline }) =>
            new Promise<Response>((_, reject) => {
              deadline.addEventListener("abort", () => {
                sawAbort = true;
                reject(deadline.reason);
              });
            }),
        }),
      ],
    });
    const started = performance.now();
    const response = await request("/slow");
    expect(performance.now() - started).toBeLessThan(1100);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("http.deadline");
    expect(sawAbort).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(records().some((r) => r.event === "http.deadline" && r.route === "/slow")).toBe(true);
  });

  test("route_deadline_bounds", () => {
    for (const deadlineMs of [130_000, 400_000, 0, 999, 1.5]) {
      expect(() => page({ method: "GET", path: "/", deadlineMs })).toThrow(/deadlineMs/);
    }
    expect(page({ method: "GET", path: "/", deadlineMs: 120_000 }).deadlineMs).toBe(120_000);
  });
});

describe("startup checks", () => {
  test("rate_limit_required_and_known", () => {
    expect(() => page({ method: "GET", path: "/", rateLimit: "" })).toThrow(/rateLimit/);
    expect(() => page({ method: "GET", path: "/", rateLimit: "exempt" })).toThrow(/static/);
    expect(() => kit({ routes: [page({ method: "GET", path: "/", rateLimit: "missing" })] })).toThrow(/missing/);
    expect(() => kit({ routes: [page({ method: "GET", path: "/" }), page({ method: "GET", path: "/" })] })).toThrow(
      /twice/,
    );
  });

  test("paths_must_be_templates", () => {
    for (const path of ["", "x", "/A", "/a//b", "/*/a", "/u/10.0.0.1", "/@alice.example"]) {
      expect(() => page({ method: "GET", path })).toThrow(/template/);
    }
  });

  test("route_table_lists_middleware", () => {
    const { server } = kit();
    const get = { accepts: [], bodyLimit: undefined, mutates: false, deadlineMs: undefined };
    expect(server.routeTable()).toEqual([
      {
        method: "GET",
        path: "/health",
        group: "static",
        ...get,
        rateLimit: "exempt",
        middleware: ["requestId", "methodCheck"],
      },
      {
        method: "GET",
        path: "/",
        group: "app",
        ...get,
        rateLimit: "page",
        middleware: ["requestId", "hostCheck", "trustedProxy", "methodCheck", "rateLimitIp"],
      },
      {
        method: "POST",
        path: "/form",
        group: "app",
        accepts: ["application/x-www-form-urlencoded"],
        bodyLimit: undefined,
        rateLimit: "page",
        mutates: true,
        deadlineMs: undefined,
        middleware: [
          "requestId",
          "hostCheck",
          "trustedProxy",
          "methodCheck",
          "contentTypeCheck",
          "bodyLimit",
          "rateLimitIp",
        ],
      },
    ]);
  });

  test("route_table_lists_every_option", () => {
    const route = page({
      method: "POST",
      path: "/upload",
      accepts: ["multipart/form-data"],
      bodyLimit: 1024,
      deadlineMs: 60_000,
      mutates: true,
      requiresSession: true,
    });
    const { server } = kit({ routes: [route] });
    expect(server.routeTable().find((r) => r.path === "/upload")).toEqual({
      method: "POST",
      path: "/upload",
      group: "app",
      accepts: ["multipart/form-data"],
      bodyLimit: 1024,
      rateLimit: "page",
      mutates: true,
      requiresSession: true,
      deadlineMs: 60_000,
      middleware: [
        "requestId",
        "hostCheck",
        "trustedProxy",
        "methodCheck",
        "contentTypeCheck",
        "bodyLimit",
        "rateLimitIp",
        "session",
        "rateLimitDid",
      ],
    });
  });

  test("trusted_proxy_on_every_route_but_health", () => {
    // Fail closed by allowlist (architecture ruling 2026-10-05): only GET /health may skip trustedProxy.
    const routes = [
      page({ method: "GET", path: "/" }),
      page({ method: "POST", path: "/form" }),
      page({ method: "GET", path: "/@:handle", group: "profile" }),
      defineRoute({ method: "GET", path: "/assets/*", group: "static", rateLimit: "exempt", handler: ok }),
    ];
    const { server } = kit({ routes });
    const skipping = server.routeTable().filter((r) => !r.middleware.includes("trustedProxy"));
    expect(skipping.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /health"]);
  });
});

describe("trusted proxy", () => {
  const seen = () => {
    const keys: (string | null)[] = [];
    const route = page({
      method: "GET",
      path: "/who",
      handler: ({ clientIp }) => {
        keys.push(clientIp?.rateKey() ?? null);
        return new Response("ok");
      },
    });
    return { keys, ...kit({ routes: [route] }) };
  };

  test("handler_gets_client_ip", async () => {
    const { keys, request } = seen();
    await request("/who", { peer: "10.0.0.2", headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9" } });
    await request("/who", { peer: "203.0.113.7", headers: { "x-forwarded-for": "9.9.9.9" } });
    await request("/who", { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(keys).toEqual(["9.9.9.9", null, null]);
  });

  test("untrusted_peer_logged_once_per_minute", async () => {
    let clock = 0;
    const { request, records } = kit({ routes: [page({ method: "GET", path: "/who" })], now: () => clock });
    const untrusted = () => request("/who", { peer: "203.0.113.7", headers: { "x-forwarded-for": "9.9.9.9" } });
    await untrusted();
    await untrusted();
    clock = 60_000;
    await untrusted();
    const lines = records().filter((r) => r.event === "proxy.untrusted_peer");
    expect(lines).toHaveLength(2);
    expect(JSON.stringify(records())).not.toContain("203.0.113.7");
    expect(JSON.stringify(records())).not.toContain("9.9.9.9");
  });

  test("health_reads_no_request_input", async () => {
    // /health answers status, service and commit only, whatever the request carries; it reads no client identity.
    const { request } = kit();
    const forged = { "x-forwarded-for": "9.9.9.9", cookie: "s=1", authorization: "Bearer x" };
    const plain = await request("/health");
    const loud = await request("/health?who=1", { peer: "203.0.113.7", host: "evil.example", headers: forged });
    expect(await loud.json()).toEqual(await plain.json());
    expect(await (await request("/health")).json()).toEqual({ status: "ok", service: "http", commit: COMMIT });
  });
});

describe("limits", () => {
  const echo = page({
    method: "POST",
    path: "/echo",
    handler: async ({ request }) => new Response(String((await request.arrayBuffer()).byteLength)),
  });
  const form = { "content-type": "application/x-www-form-urlencoded" };
  const stream = (bytes: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let sent = 0; sent < bytes; sent += 10_000)
          controller.enqueue(new Uint8Array(Math.min(10_000, bytes - sent)));
        controller.close();
      },
    });

  test("body_413_by_length", async () => {
    let called = false;
    const route = page({
      method: "POST",
      path: "/form",
      handler: () => {
        called = true;
        return new Response();
      },
    });
    const { request } = kit({ routes: [route] });
    const response = await request("/form", { method: "POST", headers: { ...form, "content-length": "70000" } });
    expect(response.status).toBe(413);
    expect(response.headers.get("connection")).toBe("close");
    expect(called).toBe(false);
  });

  test("body_413_streamed", async () => {
    const { request } = kit({ routes: [echo] });
    const big = await request("/echo", {
      method: "POST",
      headers: form,
      body: stream(70_000),
      duplex: "half",
    } as RequestInit);
    expect(big.status).toBe(413);
    const small = await request("/echo", {
      method: "POST",
      headers: form,
      body: stream(60_000),
      duplex: "half",
    } as RequestInit);
    expect(await small.text()).toBe("60000");
  });

  test("body_413_streamed_even_if_handler_swallows", async () => {
    const swallow = page({
      method: "POST",
      path: "/swallow",
      handler: async ({ request }) => {
        await request.arrayBuffer().catch(() => undefined);
        return new Response("ok");
      },
    });
    const { request } = kit({ routes: [swallow] });
    const big = await request("/swallow", {
      method: "POST",
      headers: form,
      body: stream(70_000),
      duplex: "half",
    } as RequestInit);
    expect(big.status).toBe(413);
  });

  test("route_body_limit_wins", async () => {
    const small = page({ method: "POST", path: "/small", bodyLimit: 1024, handler: echo.handler });
    const { request } = kit({ routes: [small] });
    expect((await request("/small", { method: "POST", headers: form, body: "x".repeat(2000) })).status).toBe(413);
  });

  test("body_conflicting_headers_400", async () => {
    const { request } = kit({ routes: [echo] });
    const both = { ...form, "content-length": "5", "transfer-encoding": "chunked" };
    expect((await request("/echo", { method: "POST", headers: both, body: "hello" })).status).toBe(400);
    const odd = { ...form, "content-length": "+5" };
    expect((await request("/echo", { method: "POST", headers: odd, body: "hello" })).status).toBe(400);
  });

  const LIMITED = {
    default: [{ capacity: 100, refillPerSec: 1, scope: "ip" }],
    login: [{ capacity: 2, refillPerSec: 0.1, scope: "ip" }],
    follow: [{ capacity: 120, refillPerSec: 2, scope: "did" }],
  } as const;

  test("rate_limit_429_with_retry_after", async () => {
    const login = page({ method: "GET", path: "/login", rateLimit: "login" });
    const { request } = kit({ routes: [login], policies: LIMITED });
    const peer = { peer: "10.0.0.2", headers: { "x-forwarded-for": "9.9.9.9" } };
    expect((await request("/login", peer)).status).toBe(200);
    expect((await request("/login", peer)).status).toBe(200);
    const denied = await request("/login", peer);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  test("did_limit_at_route_level", async () => {
    const follow = page({ method: "POST", path: "/follow", rateLimit: "follow", requiresSession: true });
    const session = async () => ({ did: "did:plc:alice" });
    const { request } = kit({ routes: [follow], policies: LIMITED, session });
    const statuses: number[] = [];
    for (let i = 1; i <= 121; i += 1) {
      const peer = { peer: "10.0.0.2", headers: { ...form, "x-forwarded-for": `9.9.${i >> 8}.${i & 255}` } };
      statuses.push((await request("/follow", { method: "POST", body: "a=1", ...peer })).status);
    }
    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
  });

  test("did_policy_requires_session", () => {
    const follow = page({ method: "POST", path: "/follow", rateLimit: "follow" });
    expect(() => kit({ routes: [follow], policies: LIMITED })).toThrow(/requiresSession/);
  });

  test("session_route_without_session_denies", async () => {
    let called = false;
    const follow = page({
      method: "POST",
      path: "/follow",
      rateLimit: "follow",
      requiresSession: true,
      handler: () => {
        called = true;
        return new Response();
      },
    });
    const { request, records } = kit({ routes: [follow], policies: LIMITED });
    expect((await request("/follow", { method: "POST", headers: form, body: "a=1" })).status).toBe(500);
    expect(called).toBe(false);
    expect(records().map((r) => r.event)).toContain("ratelimit.no_session");
  });

  test("salt_never_logged", async () => {
    const login = page({ method: "GET", path: "/login", rateLimit: "login" });
    const { request, lines } = kit({ routes: [login], policies: LIMITED });
    for (let i = 0; i < 5; i += 1)
      await request("/login", { peer: "10.0.0.2", headers: { "x-forwarded-for": "9.9.9.9" } });
    const text = lines.join("\n");
    expect(text).not.toMatch(/[0-9a-f]{64}/i);
    expect(text).not.toMatch(/[A-Za-z0-9+/_-]{43,}/);
  });
});
