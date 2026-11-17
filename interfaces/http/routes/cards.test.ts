// The card routes (routes/cards.ts): the owner's card writes. The app gate and the writes are stand-ins returning each
// case the routes handle; the writes themselves are tested in card-writes.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Did } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { appSessionGate, type OpenedApp } from "../app-gate.ts";
import type { CardWrite } from "../card-writes.ts";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { CARD_BODY_LIMIT_BYTES, cardRoutes } from "./cards.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));
const README = JSON.stringify({ kind: "readme", text: "Hello" });

function setup(world: { signedIn?: boolean; result?: CardWrite } = {}) {
  const calls: { did: Did; op: string; args: unknown[] }[] = [];
  const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
  const open = async (_request: Request, _deadline: AbortSignal, next: string): Promise<Response | OpenedApp> =>
    world.signedIn === false
      ? new Response(null, { status: 303, headers: { location: `/login?${new URLSearchParams({ next })}` } })
      : { session: SESSION, privacyNotice: false };
  const result = async () => world.result ?? ({ kind: "saved" } as const);
  const routes = cardRoutes({
    writes: (did) => {
      const record =
        (op: string) =>
        (...args: unknown[]) => {
          calls.push({ did, op, args });
          return result();
        };
      return { create: record("create"), save: record("save"), remove: record("remove"), reorder: record("reorder") };
    },
  });
  const server = createServer({ config: CONFIG, routes, policies, log, gate: appSessionGate(open) });
  const post = (path: string, body: string, init: { csrf?: boolean; type?: string } = {}) => {
    const headers = new Headers({
      host: "unset.test",
      "x-forwarded-for": "192.0.2.1",
      cookie: "__Host-sid=x",
      "content-type": init.type ?? "application/json",
    });
    if (init.csrf !== false) {
      headers.set("origin", ORIGIN);
      headers.set("sec-fetch-site", "same-origin");
    }
    return server.request(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body }), "10.0.0.1");
  };
  return { post, calls };
}

const errorCode = async (response: Response) => (await response.text()).match(/<p>([a-z_]+\.[a-z_]+)<\/p>/)?.[1];

describe("card routes", () => {
  test("a new card is checked and written to the session's own repo, then the page reloads", async () => {
    const { post, calls } = setup();
    const response = await post("/cards", README);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${DID}`);
    expect(calls).toEqual([{ did: DID, op: "create", args: [{ kind: "readme", text: "Hello" }, "full"] }]);
  });

  test("an edit and a delete reach the store only with a parsed card key", async () => {
    const { post, calls } = setup();
    expect((await post("/cards/3k2abc", README)).status).toBe(303);
    expect((await post("/cards/3k2abc/delete", "{}")).status).toBe(303);
    expect(calls.map((c) => [c.op, c.args[0]])).toEqual([
      ["save", "3k2abc"],
      ["remove", "3k2abc"],
    ]);
  });

  test.each(["/cards/a%00b", "/cards/%E2%80%8B", "/cards/a%2Fb", "/cards/a%20b", `/cards/${"k".repeat(600)}`])(
    "a path key that is not a record key (%s) is refused and never reaches the store",
    async (path) => {
      const { post, calls } = setup();
      // 404 from parseCardKey; the kit refuses a NUL in a path (400) before any handler runs.
      expect([400, 404]).toContain((await post(path, README)).status);
      expect([400, 404]).toContain((await post(`${path}/delete`, "{}")).status);
      expect(calls).toEqual([]);
    },
  );

  test("a reorder passes the requested order on unchanged for the writes to check", async () => {
    const { post, calls } = setup();
    expect((await post("/card-order", JSON.stringify({ order: ["b", "a"] }))).status).toBe(303);
    expect(calls).toEqual([{ did: DID, op: "reorder", args: [["b", "a"]] }]);
  });

  test("a body that is not one JSON object, or not a card, is refused before any write", async () => {
    const { post, calls } = setup();
    for (const [body, code] of [
      ["not json", "card.invalid"],
      ["[1]", "card.invalid"],
      ["null", "card.invalid"],
      [JSON.stringify({ kind: "video" }), "card.kind_unknown"],
      [JSON.stringify({ kind: "readme", text: "" }), "card.required"],
    ] as const) {
      const response = await post("/cards", body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe(code);
    }
    expect(calls).toEqual([]);
  });

  test("a form post or a body past the limit is refused by the kit", async () => {
    const { post, calls } = setup();
    expect((await post("/cards", "kind=readme&text=x", { type: "application/x-www-form-urlencoded" })).status).toBe(
      415,
    );
    const big = JSON.stringify({ kind: "readme", text: "x".repeat(CARD_BODY_LIMIT_BYTES) });
    expect((await post("/cards", big)).status).toBe(413);
    expect(calls).toEqual([]);
  });

  test("a cross-site post and a signed-out post never write", async () => {
    const crossSite = setup();
    expect((await crossSite.post("/cards", README, { csrf: false })).status).toBe(403);
    expect(crossSite.calls).toEqual([]);
    const signedOut = setup({ signedIn: false });
    expect((await signedOut.post("/cards", README)).status).toBe(303);
    expect(signedOut.calls).toEqual([]);
  });

  test("each refusal is shown with its own code, and an ended session goes to sign in", async () => {
    for (const [code, status] of [
      ["card.missing", 404],
      ["card.conflict", 409],
      ["card.order_invalid", 409],
      ["card.pds_unavailable", 503],
      ["profile.name_required", 400],
    ] as const) {
      const response = await setup({ result: { kind: "failed", code } }).post("/cards/3k2abc", README);
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
    }
    const ended = await setup({ result: { kind: "redirect", location: "/login?error=login.session_ended" } }).post(
      "/cards",
      README,
    );
    expect(ended.status).toBe(303);
    expect(ended.headers.get("location")).toBe("/login?error=login.session_ended");
  });
});
