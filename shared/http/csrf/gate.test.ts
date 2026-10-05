// The CSRF gate (P1.07) through the server kit: a POST reaches its handler only when the request is same-origin.
import { createLogger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import type { HttpKitConfig } from "../config.ts";
import { defineRoute } from "../routes.ts";
import { createServer } from "../server.ts";
import { createCsrfGate } from "./gate.ts";

const ORIGIN = "https://unset.sh";
const CONFIG: HttpKitConfig = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "http",
  UNSET_COMMIT: "c".repeat(40),
  LISTEN_PORT: 8080,
  PUBLIC_ORIGIN: ORIGIN,
  HTTP_ALLOWED_HOSTS: ["unset.sh"],
  SHUTDOWN_GRACE_MS: 1000,
  REQUEST_DEADLINE_MS: 30000,
  TRUSTED_PROXY_MODE: "socket",
  TRUSTED_PROXY_HEADER: "",
  TRUSTED_PROXY_CIDRS: [],
  TRUSTED_PROXY_HOPS: 1,
  HTTP_BODY_LIMIT_BYTES: 65_536,
  RATE_LIMIT_MAX_KEYS: 100_000,
  MEDIA_ORIGIN: "https://unset-media.test",
  ASSETS_BASE: "",
  DEV_VITE_ORIGIN: "",
};
const POLICIES = { default: [{ capacity: 10_000, refillPerSec: 100, scope: "ip" }] } as const;

function kit() {
  const calls: string[] = [];
  const lines: string[] = [];
  const handler = (name: string) => () => {
    calls.push(name);
    return new Response("ok");
  };
  const route = (path: string, accepts?: readonly string[]) =>
    defineRoute({
      method: "POST",
      path,
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: handler(path),
      ...(accepts ? { accepts } : {}),
    });
  const server = createServer({
    config: CONFIG,
    routes: [route("/follow"), route("/api-like", ["application/json"])],
    policies: POLICIES,
    log: createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: (l) => lines.push(l) }),
  });
  const post = (headers: Record<string, string>, path = "/follow", type = "application/x-www-form-urlencoded") =>
    server.request(
      new Request(`http://internal${path}`, {
        method: "POST",
        headers: { host: "unset.sh", "content-type": type, ...headers },
        body: type === "application/json" ? "{}" : "a=1",
      }),
      "203.0.113.7",
    );
  const reasons = () =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>).flatMap((r) => (r.event === "csrf.denied" ? [r] : []));
  return { post, calls, reasons };
}

async function expectDenied(headers: Record<string, string>, reason: string) {
  const { post, calls, reasons } = kit();
  const response = await post(headers);
  expect(response.status).toBe(403);
  expect(calls).toEqual([]);
  expect(reasons()).toEqual([expect.objectContaining({ route: "/follow", reason })]);
}

describe("csrf gate", () => {
  test("sfs_same_origin_allows", async () => {
    const { post, calls } = kit();
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(calls).toEqual(["/follow"]);
  });

  test("sfs_cross_site_denies", () =>
    expectDenied({ "sec-fetch-site": "cross-site", origin: ORIGIN }, "sfs_cross_site"));

  test("sfs_same_site_denies", () =>
    expectDenied({ "sec-fetch-site": "same-site", origin: "https://chat.unset.sh" }, "sfs_same_site"));

  test("sfs_none_then_origin", async () => {
    const { post, calls } = kit();
    expect((await post({ "sec-fetch-site": "none", origin: ORIGIN })).status).toBe(200);
    expect(calls).toEqual(["/follow"]);
    await expectDenied({ "sec-fetch-site": "none" }, "no_signal");
    await expectDenied({}, "no_signal");
  });

  test("origin_exact_allows", async () => {
    for (const origin of [ORIGIN, "https://UNSET.SH"]) {
      const { post, calls } = kit();
      expect((await post({ origin })).status, origin).toBe(200);
      expect(calls).toEqual(["/follow"]);
    }
  });

  test.each([
    ["https://unset.sh.evil.example", "origin_mismatch"],
    ["https://evil.unset.sh", "origin_mismatch"],
    ["http://unset.sh", "origin_mismatch"],
    ["https://unset.sh:443", "origin_mismatch"],
    [`${ORIGIN}, ${ORIGIN}`, "origin_mismatch"],
    ["null", "origin_null"],
  ])("origin_exact denies %s", (origin, reason) => expectDenied({ origin }, reason));

  test("origin_present_no_referer_fallback", () =>
    expectDenied({ origin: "https://evil.example", referer: `${ORIGIN}/settings` }, "origin_mismatch"));

  test("referer_exact", async () => {
    const { post, calls } = kit();
    expect((await post({ referer: `${ORIGIN}/settings?x=1` })).status).toBe(200);
    expect(calls).toEqual(["/follow"]);
    await expectDenied({ referer: "https://unset.sh.evil.example/" }, "referer_mismatch");
    await expectDenied({ referer: "not a url" }, "referer_mismatch");
  });

  test("json_content_type_still_gated", async () => {
    const { post, calls } = kit();
    const response = await post({ "sec-fetch-site": "cross-site" }, "/api-like", "application/json");
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("denial_renders_csrf_denied", async () => {
    const { post } = kit();
    const response = await post({ "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("csrf.denied");
  });

  test("exception_denies", () => {
    const gate = createCsrfGate(ORIGIN);
    const throwing = {
      method: "POST",
      headers: {
        get: () => {
          throw new Error("header getter failed");
        },
      },
    } as unknown as Request;
    expect(gate(throwing)).toEqual({ ok: false, reason: "error" });
  });

  test("get_and_head_not_gated", () => {
    const gate = createCsrfGate(ORIGIN);
    for (const method of ["GET", "HEAD"]) {
      expect(gate(new Request(`${ORIGIN}/`, { method, headers: { "sec-fetch-site": "cross-site" } }))).toEqual({
        ok: true,
      });
    }
  });
});
