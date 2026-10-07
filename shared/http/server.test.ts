// The server kit against in-process requests (P1.04k; the P1.04 test list except the two that need entrypoints).
import { AppError, type ErrorCode } from "@unset/shared-errors";
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import type { HttpKitConfig } from "./config.ts";
import type { ErrorPage } from "./errors.ts";
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
  MEDIA_ORIGIN: "https://unset-media.test",
  ASSETS_BASE: "",
  DEV_VITE_ORIGIN: "",
};
/** Room for every test's requests; the limits tests below set their own. */
const POLICIES = {
  default: [{ capacity: 10_000, refillPerSec: 100, scope: "ip" }],
  page: [{ capacity: 10_000, refillPerSec: 100, scope: "ip" }],
} as const;

const ok = () => new Response("ok");
const page = (spec: Partial<RouteSpec> & Pick<RouteSpec, "method" | "path">) =>
  defineRoute({ group: "app", rateLimit: "page", session: "none", handler: ok, ...spec });

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
    // A browser's same-origin POST, so these tests reach the checks they are about; csrf/gate.test.ts owns the gate.
    if (init.method === "POST" && !headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin");
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
          session: "none",
          handler: () => {
            throw new AppError("http.not_found");
          },
        }),
        defineRoute({
          method: "GET",
          path: "/media/x",
          group: "media",
          rateLimit: "page",
          session: "none",
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
          "csrf",
        ],
      },
    ]);
  });

  test("route_must_declare_session", () => {
    // Every route states its session need; there is no default (architecture ruling 2026-10-05). The type rejects a
    // route without it (tsc fails if the expect-error below goes unused), and so does defineRoute at startup.
    const spec = { method: "GET", path: "/x", group: "app", rateLimit: "page", handler: ok } as const;
    // @ts-expect-error session is required
    expect(() => defineRoute(spec)).toThrow(/session/);
    expect(() => defineRoute({ ...spec, session: "maybe" as "none" })).toThrow(/session/);
    // As the committed manifest stores it (JSON), where an unset option is absent.
    const table = (session: "required" | "none") =>
      JSON.parse(
        JSON.stringify(
          kit({ routes: [page({ method: "GET", path: "/x", session })] })
            .server.routeTable()
            .find((r) => r.path === "/x"),
        ),
      );
    expect(table("none")).not.toHaveProperty("requiresSession");
    expect(table("required")).toMatchObject({ requiresSession: true });
  });

  test("route_table_lists_every_option", () => {
    const route = page({
      method: "POST",
      path: "/upload",
      accepts: ["multipart/form-data"],
      bodyLimit: 1024,
      deadlineMs: 60_000,
      mutates: true,
      session: "required",
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
        "csrf",
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
      defineRoute({
        method: "GET",
        path: "/assets/*",
        group: "static",
        rateLimit: "exempt",
        session: "none",
        handler: ok,
      }),
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
    await request("/who", { peer: "10.0.0.2", headers: { "x-forwarded-for": "198.51.100.1, 192.0.2.9" } });
    await request("/who", { peer: "203.0.113.7", headers: { "x-forwarded-for": "192.0.2.9" } });
    await request("/who", { headers: { "x-forwarded-for": "192.0.2.9" } });
    expect(keys).toEqual(["192.0.2.9", null, null]);
  });

  test("untrusted_peer_logged_once_per_minute", async () => {
    let clock = 0;
    const { request, records } = kit({ routes: [page({ method: "GET", path: "/who" })], now: () => clock });
    const untrusted = () => request("/who", { peer: "203.0.113.7", headers: { "x-forwarded-for": "192.0.2.9" } });
    await untrusted();
    await untrusted();
    clock = 60_000;
    await untrusted();
    const lines = records().filter((r) => r.event === "proxy.untrusted_peer");
    expect(lines).toHaveLength(2);
    expect(JSON.stringify(records())).not.toContain("203.0.113.7");
    expect(JSON.stringify(records())).not.toContain("192.0.2.9");
  });

  test("health_reads_no_request_input", async () => {
    // /health answers status, service and commit only, whatever the request carries; it reads no client identity.
    const { request } = kit();
    const forged = { "x-forwarded-for": "192.0.2.9", cookie: "s=1", authorization: "Bearer x" };
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
    const peer = { peer: "10.0.0.2", headers: { "x-forwarded-for": "192.0.2.9" } };
    expect((await request("/login", peer)).status).toBe(200);
    expect((await request("/login", peer)).status).toBe(200);
    const denied = await request("/login", peer);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  test("did_limit_at_route_level", async () => {
    const follow = page({ method: "POST", path: "/follow", rateLimit: "follow", session: "required" });
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
    expect(() => kit({ routes: [follow], policies: LIMITED })).toThrow(/session: "required"/);
  });

  test("session_route_without_session_denies", async () => {
    let called = false;
    const follow = page({
      method: "POST",
      path: "/follow",
      rateLimit: "follow",
      session: "required",
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
      await request("/login", { peer: "10.0.0.2", headers: { "x-forwarded-for": "192.0.2.9" } });
    const text = lines.join("\n");
    expect(text).not.toMatch(/[0-9a-f]{64}/i);
    expect(text).not.toMatch(/[A-Za-z0-9+/_-]{43,}/);
  });
});

describe("error page hook", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  type Seen = { code: string; ctx: { group: string; reqId?: string } };
  const spy = (render: (code: string, ctx: Seen["ctx"]) => unknown = (code) => `<p>designed ${code}</p>`) => {
    const seen: Seen[] = [];
    const errorPage = ((code: string, ctx: Seen["ctx"]) => {
      seen.push({ code, ctx: { ...ctx } });
      return render(code, ctx);
    }) as ErrorPage;
    return { seen, errorPage };
  };
  const throwing = (code: ErrorCode) => () => {
    throw new AppError(code);
  };
  const routes = [
    page({ method: "GET", path: "/boom", handler: throwing("internal.error") }),
    page({ method: "GET", path: "/@:handle", group: "profile", handler: throwing("http.not_found") }),
    page({ method: "GET", path: "/terms", group: "public", handler: throwing("http.not_found") }),
    page({ method: "GET", path: "/limited", handler: throwing("http.rate_limited") }),
    page({ method: "POST", path: "/form" }),
    defineRoute({
      method: "GET",
      path: "/api/x",
      group: "api",
      rateLimit: "page",
      session: "none",
      handler: throwing("http.not_found"),
    }),
    defineRoute({
      method: "GET",
      path: "/media/x",
      group: "media",
      rateLimit: "page",
      session: "none",
      handler: throwing("http.not_found"),
    }),
    page({
      method: "GET",
      path: "/spent",
      handler: () => {
        const spent = new Response("x");
        void spent.body?.getReader(); // a locked body cannot be copied, so securing it throws
        return spent;
      },
    }),
  ];

  test("error_page_hook_renders_page_groups", async () => {
    const { seen, errorPage } = spy();
    const { request } = kit({ routes, errorPage });
    expect(await (await request("/nothing")).text()).toBe("<p>designed http.not_found</p>");
    expect(await (await request("/@a")).text()).toBe("<p>designed http.not_found</p>");
    const admin = kit({ routes, errorPage, errorGroup: "admin" });
    expect(await (await admin.request("/nothing")).text()).toBe("<p>designed http.not_found</p>");
    expect(await (await request("/terms")).text()).toBe("<p>designed http.not_found</p>");
    expect(seen.map((s) => s.ctx.group)).toEqual(["app", "profile", "admin", "public"]);
    seen.length = 0;
    expect(await (await request("/api/x")).json()).toEqual({ error: "http.not_found" });
    expect(await (await request("/media/x")).text()).toBe("");
    expect(await (await request("/assets/x")).text()).toBe("");
    expect(seen).toEqual([]);
  });

  test("error_page_hook_receives_no_request_data", async () => {
    const { seen, errorPage } = spy();
    const { request, records } = kit({ routes, errorPage });
    const headers = { cookie: "__Host-theme=dark", "accept-language": "fr" };
    await request("/nothing?q=secret-query", { headers });
    await request("/boom?q=secret-query", { headers });
    await request("/form", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const reqIds = records()
      .filter((r) => r.event === "http.request")
      .map((r) => r.reqId);
    expect(seen).toEqual([
      { code: "http.not_found", ctx: { group: "app" } },
      { code: "internal.error", ctx: { group: "app", reqId: reqIds[1] } },
      { code: "http.unsupported_media_type", ctx: { group: "app" } },
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/secret|nothing|theme|fr/);
  });

  test("error_page_hook_throw_falls_back", async () => {
    const { request: plain } = kit({ routes });
    const fixed = await plain("/nothing");
    const { request, records } = kit({
      routes,
      errorPage: () => {
        throw new Error("render blew up with private text");
      },
    });
    const response = await request("/nothing");
    expect(response.status).toBe(404);
    expect([...response.headers]).toEqual([...fixed.headers]);
    const body = await response.text();
    expect(body).toBe(await fixed.text());
    expect(body).not.toContain("private text");
    expect(records().filter((r) => r.event === "error")).toHaveLength(1);
    expect(JSON.stringify(records())).not.toContain("private text");
  });

  test("error_page_hook_non_string_or_oversize_falls_back", async () => {
    const fixed = await (await kit({ routes }).request("/nothing")).text();
    for (const result of [undefined, 42, Promise.resolve("<p>late</p>"), "x".repeat(256 * 1024 + 1)]) {
      const { request, records } = kit({ routes, errorPage: spy(() => result).errorPage });
      const response = await request("/nothing");
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(fixed);
      expect(records().filter((r) => r.event === "error")).toHaveLength(1);
    }
    const { request } = kit({ routes, errorPage: spy(() => "x".repeat(256 * 1024)).errorPage });
    expect((await (await request("/nothing")).text()).length).toBe(256 * 1024);
  });

  test("error_page_hook_keeps_kit_headers", async () => {
    const { errorPage } = spy();
    const hooked = kit({ routes, errorPage });
    const plain = kit({ routes });
    const policies = { ...POLICIES, page: [{ capacity: 1, refillPerSec: 0.001, scope: "ip" }] } as const;
    const once = [page({ method: "GET", path: "/once" })];
    const sends: [string, RequestInit?][] = [["/nothing"], ["/boom"], ["/", { method: "PUT" }]];
    for (const [path, init] of sends) {
      const a = await hooked.request(path, init);
      const b = await plain.request(path, init);
      expect(a.status, path).toBe(b.status);
      for (const name of ["content-type", "cache-control", "allow", "content-security-policy", "x-frame-options"]) {
        expect(a.headers.get(name), `${path} ${name}`).toBe(b.headers.get(name));
      }
      expect(a.headers.get("content-security-policy"), path).toBeTruthy();
    }
    const limited = kit({ routes: once, policies, errorPage });
    await limited.request("/once");
    const over = await limited.request("/once");
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await over.text()).toBe("<p>designed http.rate_limited</p>");
  });

  test("internal_error_body_has_kit_request_id", async () => {
    const { request, records } = kit({
      routes,
      errorPage: spy((code, ctx) => `<p>${code} ${ctx.reqId ?? "-"}</p>`).errorPage,
    });
    const body = await (await request("/boom")).text();
    const reqId = records().find((r) => r.event === "http.request")?.reqId;
    expect(reqId).toMatch(UUID);
    expect(body).toBe(`<p>internal.error ${reqId}</p>`);
    for (const path of ["/nothing", "/limited"]) {
      expect(await (await request(path)).text(), path).toMatch(/ -<\/p>$/);
    }
  });

  test("not_found_body_identical_across_requests", async () => {
    for (const errorPage of [undefined, spy().errorPage]) {
      const { request } = kit({ routes, ...(errorPage ? { errorPage } : {}) });
      const a = await request("/one?x=1", { headers: { cookie: "a=b", "accept-language": "fr" } });
      const b = await request("/two/three?y=%3Cz%3E", { headers: { "accept-language": "en" } });
      expect(a.status).toBe(404);
      expect(await a.text()).toBe(await b.text());
      expect(a.headers.get("cache-control")).toBe("no-cache");
      expect(b.headers.get("cache-control")).toBe("no-cache");
    }
    const { request } = kit({ routes });
    expect((await request("/api/x")).headers.get("cache-control")).toBe("no-store");
    expect((await request("/", { method: "PUT" })).headers.get("cache-control")).toBe("no-store");
    expect((await request("/boom")).headers.get("cache-control")).toBe("no-store");
  });

  test("error_page_hook_cap_counts_bytes", async () => {
    const fixed = await (await kit({ routes }).request("/nothing")).text();
    const wide = "é".repeat(128 * 1024 + 1); // under 256 Ki characters, over 256 KiB in UTF-8
    expect(wide.length).toBeLessThan(256 * 1024);
    const { request, records } = kit({ routes, errorPage: spy(() => wide).errorPage });
    expect(await (await request("/nothing")).text()).toBe(fixed);
    expect(records().filter((r) => r.event === "error")).toHaveLength(1);
  });

  test("not_found_no_cache_in_every_page_group", async () => {
    for (const errorPage of [undefined, spy().errorPage]) {
      const hook = errorPage ? { errorPage } : {};
      const { request } = kit({ routes, ...hook });
      const admin = kit({ routes, ...hook, errorGroup: "admin" });
      const sent = [
        await request("/nothing"),
        await request("/@a"),
        await request("/terms"),
        await admin.request("/x"),
      ];
      for (const response of sent) {
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-cache");
      }
    }
  });

  test("payload_too_large_closes_connection", async () => {
    const form = { "content-type": "application/x-www-form-urlencoded", "content-length": "70000" };
    for (const errorPage of [undefined, spy().errorPage]) {
      const { request } = kit({
        routes: [page({ method: "POST", path: "/form" })],
        ...(errorPage ? { errorPage } : {}),
      });
      const response = await request("/form", { method: "POST", headers: form });
      expect(response.status).toBe(413);
      expect(response.headers.get("connection")).toBe("close");
    }
  });

  test("error_page_hook_promise_is_type_error", () => {
    // @ts-expect-error: the hook is synchronous; a Promise-returning render is refused by type.
    const asyncPage: ErrorPage = async (code: ErrorCode) => `<p>${code}</p>`;
    expect(typeof asyncPage).toBe("function");
  });

  test("secured_fallback_never_calls_hook", async () => {
    const { seen, errorPage } = spy();
    const { request } = kit({ routes, errorPage });
    const response = await request("/spent");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(seen).toEqual([]);
  });
});
