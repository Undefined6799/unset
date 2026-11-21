import { createServer, type Server } from "node:http"; // guard-allow: egress test listener on loopback only
import { mintDraftPath } from "@unset/domains-content";
import { afterEach, describe, expect, test } from "vitest";
import { type MediaDeps, mediaListener } from "./serve.ts";

const KEY = new Uint8Array(32).fill(7);
const KEYS = { active: "k1", key: (kid: string) => (kid === "k1" ? KEY : undefined) };
const OBJECT = "drafts/did:plc:abcdefghijklmnopqrstuvwx/i/0b8e0b8e-1111-4222-8333-444455556666/w960.avif";
const NOW = 1_800_000_000;
const BYTES = new Uint8Array([1, 2, 3, 4]);
const SANDBOX = {
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
};

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** The listener on a loopback port, with a store double holding `objects` (the store is an unmanaged dependency). */
async function start(objects: Record<string, Uint8Array> | "down" = { [OBJECT]: BYTES }, now = NOW) {
  const logged: Array<{ route: string; status: number }> = [];
  const deps: MediaDeps = {
    keys: KEYS,
    nowS: () => now,
    get: async (key) => (objects === "down" ? { ok: false } : { ok: true, bytes: objects[key] ?? null }),
    logged: (route, status) => logged.push({ route, status }),
  };
  server = createServer(mediaListener(deps));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const call = (target: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${target}`, init);
  return { call, logged };
}

const headersOf = (response: Response) => Object.fromEntries(response.headers);
const link = (objectKey = OBJECT) => mintDraftPath(KEYS, objectKey, NOW);

describe("media serves signed draft versions (book P2.19)", () => {
  test("media.serves_signed: a valid link answers the bytes with the sandbox and cache headers", async () => {
    const { call } = await start();
    const response = await call(link());
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    const exp = Math.ceil((NOW + 300) / 60) * 60;
    expect(headersOf(response)).toMatchObject({
      ...SANDBOX,
      "content-type": "image/avif",
      "content-length": "4",
      "content-disposition": "inline",
      "cache-control": `private, max-age=${Math.min(exp - NOW, 300)}`,
    });
  });

  test("media.head: HEAD answers the headers with no body", async () => {
    const { call } = await start();
    const response = await call(link(), { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("4");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  test("media.content_type_by_extension: jpeg and webp versions get their own type", async () => {
    const jpeg = OBJECT.replace("w960.avif", "main.jpeg");
    const webp = OBJECT.replace("w960.avif", "w480.webp");
    const { call } = await start({ [jpeg]: BYTES, [webp]: BYTES });
    expect((await call(link(jpeg))).headers.get("content-type")).toBe("image/jpeg");
    expect((await call(link(webp))).headers.get("content-type")).toBe("image/webp");
  });

  test("media.headers_on_errors: 404, 405 and 503 carry the sandbox headers and no-store", async () => {
    for (const [objects, target, init, status] of [
      [{}, link(), {}, 404],
      [undefined, "/anything", {}, 404],
      [undefined, link(), { method: "POST" }, 405],
      ["down", link(), {}, 503],
    ] as const) {
      const { call } = await start(objects);
      const response = await call(target, init);
      expect(response.status, `${status}`).toBe(status);
      expect(headersOf(response)).toMatchObject({ ...SANDBOX, "cache-control": "no-store" });
      await server?.close();
      server = undefined;
    }
  });

  test("media.refusals_look_alike: a tampered, expired or unknown link is the same 404", async () => {
    const { call } = await start({ [OBJECT]: BYTES }, NOW + 400);
    const bodies = new Set<string>();
    for (const target of [link(), link().replace("w960", "w480"), "/o/draft-preview/x"]) {
      const response = await call(target);
      expect(response.status).toBe(404);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
  });

  test("media.too_large: a 5,000,000-byte main version is served; an object over 5 MiB is not (ADR 0088)", async () => {
    const fits = await start({ [OBJECT]: new Uint8Array(5_000_000) });
    expect((await fits.call(link())).status).toBe(200);
    const { call } = await start({ [OBJECT]: new Uint8Array(5 * 1024 * 1024 + 1) });
    expect((await call(link())).status).toBe(404);
  });

  test("media.no_cookies_read: a cookie changes nothing and no answer sets one", async () => {
    const { call } = await start();
    const response = await call(link(), { headers: { cookie: "__Host-session=x" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("media.health: GET /health answers 200", async () => {
    const { call } = await start();
    expect((await call("/health")).status).toBe(200);
  });

  test("media.logs_template_only: the log names the route template and status, never the key or the link", async () => {
    const { call, logged } = await start();
    await call(link());
    await call("/o/draft-preview/nothing");
    await call("/health");
    expect(logged).toEqual([
      { route: "/o/:purpose/*", status: 200 },
      { route: "/o/:purpose/*", status: 404 },
      { route: "/health", status: 200 },
    ]);
  });
});
