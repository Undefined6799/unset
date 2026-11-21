// The door's GET half (build step 6; ADR 0081 decision 4; security pass finding 8): /sign-in sets the one-time value
// in a __Host- cookie and sends the tab to web; / and /sign-in/return are the chat page (ADR 0088) and its built files
// are served under /assets/; every other path is 404, every other method 405, a foreign Host 421, and every POST
// passes the CSRF gate first. Each answer is one log line of route template, status and reason only (SE-7).
import { createRateLimiter } from "@unset/shared-http";
import { describe, expect, test } from "vitest";
import { createDoor, type DoorLog } from "./door.ts";
import type { ChatPage } from "./page.ts";

const ORIGIN = "https://unset.cc";
const WEB = "https://unset.sh";
const STATE = Buffer.alloc(32, 7);
const STATE_TEXT = STATE.toString("base64url");
const PAGE: ChatPage = {
  html: "<!doctype html><title>Messages</title>",
  files: new Map([
    ["/assets/index-abc.js", { body: new TextEncoder().encode("export {};"), type: "text/javascript; charset=utf-8" }],
    ["/assets/crypto-abc.wasm", { body: new Uint8Array([0, 97, 115, 109]), type: "application/wasm" }],
  ]),
};

function door(limit = 100, signInLimit = limit) {
  const lines: DoorLog[] = [];
  const handle = createDoor({
    origin: ORIGIN,
    webOrigin: WEB,
    allowedHosts: ["unset.cc"],
    limiter: createRateLimiter(
      {
        default: [{ capacity: limit, refillPerSec: 1, scope: "ip" }],
        "sign-in": [{ capacity: signInLimit, refillPerSec: 1, scope: "ip" }],
      },
      { maxKeys: 100, onError: () => undefined },
    ),
    clientIp: () => null,
    random: () => STATE,
    log: (line) => lines.push(line),
    page: PAGE,
    // Stands for POST /sign-in/redeem, the hop's one spend of the sign-in bucket (routes.ts redeemRoute).
    posts: { "/redeem": { limit: "sign-in", handle: async () => ({ response: new Response(null, { status: 204 }) }) } },
  });
  const get = (path: string, headers: Record<string, string> = {}) =>
    handle(new Request(`${ORIGIN}${path}`, { headers: { host: "unset.cc", ...headers } }), "10.0.0.1");
  return { handle, get, lines };
}

/** The Set-Cookie lines of `res`, by cookie name. */
const cookies = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));

describe("GET /sign-in", () => {
  test("door.sign_in_state: sets a 32-byte __Host- state cookie and 303s to web with that value", async () => {
    const { get, lines } = door();
    const res = await get("/sign-in");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${WEB}/chat/sign-in?state=${STATE_TEXT}`);
    const state = cookies(res)["__Host-chat-state"] ?? "";
    expect(state).toBe(`__Host-chat-state=${STATE_TEXT}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`);
    expect(state.toLowerCase()).not.toContain("domain");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(lines).toEqual([{ route: "/sign-in", method: "GET", status: 303 }]);
  });

  test("door.sign_in_return_path: an allowed same-origin path is kept in its own cookie; the default is /", async () => {
    const { get } = door();
    const kept = cookies(await get("/sign-in?return=%2Fc%2Fabc"))["__Host-chat-return"];
    expect(kept).toBe("__Host-chat-return=%2Fc%2Fabc; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax");
    expect(cookies(await get("/sign-in"))["__Host-chat-return"]).toContain("__Host-chat-return=%2F;");
  });

  test.each([
    ["https://evil.example/"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["/sign-in"],
    ["/sign-in/return"],
    ["javascript:alert(1)"],
  ])("door.sign_in_bad_return: %s is refused with no cookie and no redirect", async (target) => {
    const { get } = door();
    const res = await get(`/sign-in?${new URLSearchParams({ return: target })}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "chat.bad_return" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("door.sign_in_two_returns: a repeated return parameter is refused", async () => {
    expect((await door().get("/sign-in?return=/a&return=/b")).status).toBe(400);
  });

  test("door.sign_in_one_spend_per_load: the hop's start spends nothing of the sign-in bucket; redeem spends one", async () => {
    // A page load is GET /sign-in then POST /sign-in/redeem; behind one shared address each load costs one sign-in.
    const { handle, get } = door(100, 1);
    expect((await get("/sign-in")).status).toBe(303);
    expect((await get("/sign-in")).status).toBe(303);
    const redeem = () =>
      handle(
        new Request(`${ORIGIN}/redeem`, { method: "POST", headers: { host: "unset.cc", origin: ORIGIN } }),
        "10.0.0.1",
      );
    expect((await redeem()).status).toBe(204);
    expect((await redeem()).status).toBe(429);
  });

  test("door.sign_in_limited: past the page's bucket the hop's start answers 429 and sets nothing", async () => {
    const { get } = door(1);
    expect((await get("/sign-in")).status).toBe(303);
    const res = await get("/sign-in");
    expect(res.status).toBe(429);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("the chat page", () => {
  const CSP =
    `default-src 'none'; script-src ${ORIGIN}/assets/ 'wasm-unsafe-eval'; style-src ${ORIGIN}/assets/; ` +
    `font-src ${ORIGIN}/assets/; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; ` +
    "form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html";

  test.each([["/"], ["/sign-in/return"], ["/welcome"]])(
    "door.page_document: %s is the page, with its CSP, no referrer and no-store",
    async (path) => {
      const res = await door().get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy")).toBe(CSP);
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(await res.text()).toBe(PAGE.html);
    },
  );

  test("door.welcome_done: the onboarding page's way back is a fixed 303 to web's chat step, whatever the query", async () => {
    const { get, lines } = door();
    for (const path of ["/welcome/done", "/welcome/done?next=https%3A%2F%2Fevil.example%2F"]) {
      const res = await get(path);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${WEB}/welcome/chat`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(lines.at(-1)).toEqual({ route: "/welcome/done", method: "GET", status: 303 });
  });

  test("door.page_files: a built file is served with its type, cached for good, under the door's default CSP", async () => {
    const res = await door().get("/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(await res.text()).toBe("export {};");
    const wasm = await door().get("/assets/crypto-abc.wasm");
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
  });

  test.each([["/assets/other.js"], ["/assets/"], ["/assets/%2e%2e/index.html"], ["/sign-in/return.js"], ["/c/x"]])(
    "door.page_unknown: %s is 404",
    async (path) => {
      expect((await door().get(path)).status).toBe(404);
    },
  );

  test("door.page_files_get_only: a POST to a built file is 405", async () => {
    const res = await door().handle(
      new Request(`${ORIGIN}/assets/index-abc.js`, { method: "POST", headers: { host: "unset.cc", origin: ORIGIN } }),
      undefined,
    );
    expect(res.status).toBe(405);
  });
});

describe("the door's edges", () => {
  test("door.unknown_path: 404 with the security headers", async () => {
    const res = await door().get("/anything");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("door.method: a PUT is 405 and a POST to a GET route is 405, after the gate", async () => {
    const { handle } = door();
    const put = await handle(
      new Request(`${ORIGIN}/sign-in`, { method: "PUT", headers: { host: "unset.cc", origin: ORIGIN } }),
      undefined,
    );
    expect(put.status).toBe(405);
    const post = await handle(
      new Request(`${ORIGIN}/sign-in`, { method: "POST", headers: { host: "unset.cc", origin: ORIGIN } }),
      undefined,
    );
    expect(post.status).toBe(405);
  });

  test("door.csrf_first: a cross-site POST is 403 csrf.denied, logged with the gate's reason", async () => {
    const { handle, lines } = door();
    const res = await handle(
      new Request(`${ORIGIN}/sign-in`, {
        method: "POST",
        headers: { host: "unset.cc", origin: "https://evil.example" },
      }),
      undefined,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf.denied" });
    expect(lines).toEqual([{ route: "/sign-in", method: "POST", status: 403, reason: "origin_mismatch" }]);
  });

  test("door.host: a Host the door does not serve is 421", async () => {
    expect((await door().get("/sign-in", { host: "unset.sh" })).status).toBe(421);
  });

  test("door.health: 200 with no cookie", async () => {
    const res = await door().get("/health");
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("door.log_no_query: a logged line names the route template, never the query", async () => {
    const { get, lines } = door();
    await get("/sign-in?return=%2Fsecret-path");
    expect(JSON.stringify(lines)).not.toContain("secret");
  });
});
