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
};

const ok = () => new Response("ok");
const page = (spec: Partial<RouteSpec> & Pick<RouteSpec, "method" | "path">) =>
  defineRoute({ group: "app", rateLimit: "page", handler: ok, ...spec });

function kit(options: Partial<ServerOptions> = {}) {
  const lines: string[] = [];
  const log = createLogger({ service: "http", commit: COMMIT, env: "test", write: (line) => lines.push(line) });
  const server = createServer({
    config: CONFIG,
    routes: [page({ method: "GET", path: "/" }), page({ method: "POST", path: "/form" })],
    policies: { page: {} },
    log,
    ...options,
  });
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const request = (path: string, init: RequestInit & { host?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.host !== "") headers.set("host", init.host ?? "unset.test");
    return server.request(new Request(`http://internal${path}`, { ...init, headers }));
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
    expect(server.routeTable()).toEqual([
      { method: "GET", path: "/health", group: "static", middleware: ["requestId", "methodCheck"] },
      { method: "GET", path: "/", group: "app", middleware: ["requestId", "hostCheck", "methodCheck"] },
      {
        method: "POST",
        path: "/form",
        group: "app",
        middleware: ["requestId", "hostCheck", "methodCheck", "contentTypeCheck"],
      },
    ]);
  });
});
