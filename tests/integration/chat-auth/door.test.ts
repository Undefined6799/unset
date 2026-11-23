// The unset.cc door end to end (build step 6; ADR 0093 decision 4, ADR 0095 decisions 4 and 5): its own composition
// root, against real Postgres as `chat_auth` (TE-2), real chat-admin on loopback through a real net-guard, and web's own
// client signing the tickets. Only MAS is a fake (harness.ts; an unmanaged dependency, TE-1). Every route has its
// denial cases: no cookie, a wrong one-time value, a wrong Origin, an expired or replayed ticket, another member's
// ticket in the same browser, and chat-admin down, which answers a typed 503 and nothing more. unset.sh's Log out
// (POST /sign-out/redeem) mints only on the entry this browser already holds, and never renews it. The chat count
// (ADR 0101): the pushkey route's denials, Synapse's two bodies on the count port, strict parsing, and that the public
// listener serves neither count route.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Did, Handle } from "@unset/domains-identity";
import {
  type ChatUser,
  type DoorState,
  newChatUser,
  parseDoorState,
  type SessionRef,
  sessionRef,
} from "@unset/domains-messaging";
import { createChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { createPool, withClient } from "@unset/infrastructure-postgres";
import { loadConfig } from "@unset/shared-config";
import { afterAll, afterEach, beforeEach, describe, expect, inject, test } from "vitest";
import { compose } from "../../../interfaces/chat-auth/compose.ts";
import { schema } from "../../../interfaces/chat-auth/config.ts";
import { type FakeMas, fakeMas, startService } from "../chat-admin/harness.ts";

/** The redeem routes need no page; the page itself is tests/e2e/chat-page.chromium.spec.ts's. */
const PAGE = { html: "<!doctype html>", files: new Map() };
const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const ORIGIN = "https://unset.cc";
const ALICE = `did:plc:${"a".repeat(24)}` as Did;
const BOB = `did:plc:${"b".repeat(24)}` as Did;
const guard = createNetGuard({ internalHosts: [], allowLoopback: true, commit: "c".repeat(40) });

const dir = mkdtempSync(join(tmpdir(), "chat-auth-"));
function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o600);
  return path;
}

let mas: FakeMas;
let service: Awaited<ReturnType<typeof startService>>;
let door: Awaited<ReturnType<typeof compose>>;
const logs: string[] = [];
const db = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.chat_auth, database, ssl: false },
  service: "door-test",
  max: 2,
  connectTimeoutMs: 5000,
});
afterAll(() => db.end());

beforeEach(async () => {
  // Each test starts with an empty list for the two members it signs in.
  await withClient(db, null, (c) => c.query("DELETE FROM door.browser WHERE did = ANY($1)", [[ALICE, BOB]]));
  mas = await fakeMas();
  service = await startService(mas);
  const env = {
    UNSET_ENV: "dev",
    UNSET_SERVICE: "chat-auth",
    UNSET_COMMIT: "c".repeat(40),
    LISTEN_PORT: "8090",
    PUBLIC_ORIGIN: ORIGIN,
    HTTP_ALLOWED_HOSTS: "unset.cc",
    TRUSTED_PROXY_MODE: "socket",
    WEB_ORIGIN: "https://unset.sh",
    PG_HOST: provided.host,
    PG_PORT: String(provided.port),
    PG_DATABASE: database,
    PG_USER: "chat_auth",
    PG_PASSWORD_FILE: file("pg", provided.roles.chat_auth.password),
    PG_SSLMODE: "disable",
    PG_POOL_MAX: "2",
    SEAL_KEYRING_FILE: file("seal", JSON.stringify({ active: "d1", keys: { d1: randomBytes(32).toString("base64") } })),
    NETGUARD_ALLOW_LOOPBACK: "true",
    CHAT_ADMIN_URL: service.base,
    CHAT_ADMIN_DOOR_KEY_FILE: file("door", String(service.door.privateKey.export({ type: "pkcs8", format: "pem" }))),
    CHAT_ADMIN_DOOR_KID: service.door.kid,
    CHAT_SERVER_NAME: "staging.unset.cc",
    COUNT_LISTEN_PORT: "8091",
    COUNT_ORIGIN: "http://chat-auth:8091",
    LISTEN_ADDRESS: "127.0.0.1",
    COUNT_LISTEN_ADDRESS: "127.0.0.2",
  };
  door = await compose(
    loadConfig(schema, env),
    {
      request: (line) => logs.push(JSON.stringify(line)),
      untrustedPeer: () => undefined,
    },
    PAGE,
  );
});
afterEach(async () => {
  await door.close();
  await service.close();
  await mas.close();
});

const web = (now?: () => number) =>
  createChatAdminClient(
    guard,
    { origin: service.base, env: "dev", key: { kid: service.web.kid, privateKey: service.web.privateKey } },
    now,
  );

/** A member whose chat account chat-admin has created in MAS. */
async function member(): Promise<ChatUser> {
  const user = newChatUser((n) => randomBytes(n));
  expect(await web().createAccount(user, "a.unset.name" as Handle)).toEqual({ kind: "created" });
  return user;
}

/** One browser's cookie jar, as the door sets it. */
function browser() {
  const jar = new Map<string, string>();
  const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const keep = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split("; ");
      const name = pair.slice(0, pair.indexOf("="));
      if (attributes.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, pair.slice(name.length + 1));
    }
    return res;
  };
  const get = async (path: string) =>
    keep(
      await door.handle(
        new Request(`${ORIGIN}${path}`, { headers: { host: "unset.cc", cookie: header() } }),
        "127.0.0.1",
      ),
    );
  const post = async (path: string, body: unknown, origin = ORIGIN) =>
    keep(
      await door.handle(
        new Request(`${ORIGIN}${path}`, {
          method: "POST",
          headers: { host: "unset.cc", origin, cookie: header(), "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        "127.0.0.1",
      ),
    );
  /** GET /sign-in, then web's ticket for `did` on web session `sid`, bound to the value this browser now holds. */
  const hop = async (user: ChatUser, did = ALICE, now?: () => number, sid = sessionRef(Buffer.alloc(32, 1))) => {
    await get("/sign-in?return=%2Fc%2Fx");
    const state = parseDoorState(jar.get("__Host-chat-state") ?? null);
    if (state === null) throw new Error("no state cookie");
    return web(now).signTicket({ user, did, sid, state });
  };
  return { jar, get, post, hop };
}

const rowsOf = (did: Did) =>
  withClient(db, null, async (c) => {
    const { rows } = await c.query<{ device_id: string }>("SELECT device_id FROM door.browser WHERE did = $1", [did]);
    return rows.map((r) => r.device_id);
  });
const activeOn = (device: string) => mas.sessions.filter((s) => !s.revoked && s.scope.endsWith(`device:${device}`));

describe("POST /sign-in/redeem", () => {
  test("door.redeem_signs_in: a token, the member's chat ID, a device and a 32-byte lock key; the hop cookies go", async () => {
    const user = await member();
    const tab = browser();
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, string>;
    expect(body.newDevice).toBe(true);
    expect(Object.keys(body).sort()).toEqual([
      "accessToken",
      "deviceId",
      "expiresAt",
      "newDevice",
      "returnTo",
      "storageKey",
      "userId",
    ]);
    expect(body.userId).toBe(`@${user}:staging.unset.cc`);
    expect(body.deviceId).toMatch(/^[A-Z0-9]{10}$/);
    expect(Buffer.from(body.storageKey ?? "", "base64url")).toHaveLength(32);
    expect(Date.parse(body.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(body.returnTo).toBe("/c/x");
    expect(activeOn(body.deviceId ?? "")).toHaveLength(1);
    expect([...tab.jar.keys()]).toEqual(["__Host-chat-browser"]);
    const set = res.headers.getSetCookie().find((l) => l.startsWith("__Host-chat-browser="));
    expect(set).toMatch(/; Path=\/; Max-Age=34560000; Secure; HttpOnly; SameSite=Strict$/);
    expect(await rowsOf(ALICE)).toEqual([body.deviceId]);
  });

  test("door.redeem_dock: the chat box's own one-time value signs it in, and its cookies are partitioned (ADR 0115)", async () => {
    const user = await member();
    const box = browser();
    // The box sets its value in its own cookie (apps/chat/core/dock.ts); a frame cannot take the hop's Lax ones.
    const state = parseDoorState(Buffer.alloc(32, 9).toString("base64url"));
    if (state === null) throw new Error("no state");
    box.jar.set("__Host-chat-state", state);
    const ticket = await web().signTicket({ user, did: ALICE, sid: sessionRef(Buffer.alloc(32, 1)), state });
    const res = await box.post("/sign-in/redeem?dock", { ticket });
    expect(res.status).toBe(200);
    const lines = res.headers.getSetCookie();
    expect(lines.find((l) => l.startsWith("__Host-chat-browser="))).toMatch(
      /; Path=\/; Max-Age=34560000; Secure; HttpOnly; SameSite=None; Partitioned$/,
    );
    expect(lines.find((l) => l.startsWith("__Host-chat-state="))).toMatch(
      /; Max-Age=0; Secure; HttpOnly; SameSite=None; Partitioned$/,
    );
    expect([...box.jar.keys()]).toEqual(["__Host-chat-browser"]);
    // The same box comes back to the same device.
    box.jar.set("__Host-chat-state", state);
    const again = await box.post("/sign-in/redeem?dock", {
      ticket: await web().signTicket({ user, did: ALICE, sid: sessionRef(Buffer.alloc(32, 1)), state }),
    });
    expect(((await again.json()) as { deviceId: string }).deviceId).toBe(
      ((await res.json()) as { deviceId: string }).deviceId,
    );
  });

  test("door.redeem_after_expiry: a new hop in the same browser gets the same device and lock key, minted first", async () => {
    const user = await member();
    const tab = browser();
    const first = (await (await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) })).json()) as Record<
      string,
      string
    >;
    const again = (await (await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) })).json()) as Record<
      string,
      string
    >;
    expect([again.deviceId, again.storageKey]).toEqual([first.deviceId, first.storageKey]);
    expect([first.newDevice, again.newDevice]).toEqual([true, false]);
    expect(again.accessToken).not.toBe(first.accessToken);
    expect(activeOn(first.deviceId ?? "")).toHaveLength(1);
  });

  test("door.redeem_replay: the same ticket again fails at the door (value gone) and at chat-admin (jti burned)", async () => {
    const user = await member();
    const tab = browser();
    const ticket = await tab.hop(user);
    const state = tab.jar.get("__Host-chat-state") ?? "";
    expect((await tab.post("/sign-in/redeem", { ticket })).status).toBe(200);
    const again = await tab.post("/sign-in/redeem", { ticket });
    expect([again.status, await again.json()]).toEqual([403, { error: "chat.no_state" }]);
    // A browser that kept its value still cannot spend the ticket twice.
    tab.jar.set("__Host-chat-state", state);
    const kept = await tab.post("/sign-in/redeem", { ticket });
    expect([kept.status, await kept.json()]).toEqual([403, { error: "chat.ticket_refused" }]);
    expect(mas.sessions.filter((s) => !s.revoked)).toHaveLength(1);
  });

  test("door.redeem_wrong_state: a ticket made for another browser's value mints nothing", async () => {
    const user = await member();
    const victim = browser();
    const ticket = await browser().hop(user);
    await victim.get("/sign-in");
    const res = await victim.post("/sign-in/redeem", { ticket });
    expect([res.status, await res.json()]).toEqual([403, { error: "chat.state_mismatch" }]);
    expect(mas.sessions).toEqual([]);
    expect(victim.jar.has("__Host-chat-state")).toBe(false);
  });

  test("door.redeem_no_cookie: with no one-time value at all nothing is minted", async () => {
    const user = await member();
    const tab = browser();
    const ticket = await tab.hop(user);
    tab.jar.clear();
    const res = await tab.post("/sign-in/redeem", { ticket });
    expect([res.status, await res.json()]).toEqual([403, { error: "chat.no_state" }]);
    expect(mas.sessions).toEqual([]);
  });

  test("door.redeem_wrong_origin: a cross-site post is refused by the CSRF gate before anything is read", async () => {
    const user = await member();
    const tab = browser();
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) }, "https://evil.example");
    expect([res.status, await res.json()]).toEqual([403, { error: "csrf.denied" }]);
    expect(mas.sessions).toEqual([]);
    expect(tab.jar.has("__Host-chat-state")).toBe(true);
  });

  test("door.redeem_expired: a ticket past its 60 seconds is refused before chat-admin", async () => {
    const user = await member();
    const tab = browser();
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(user, ALICE, () => Date.now() - 120_000) });
    expect([res.status, await res.json()]).toEqual([403, { error: "chat.ticket_expired" }]);
    expect(mas.sessions).toEqual([]);
  });

  test("door.redeem_bad_ticket: a ticket that is not web's envelope is 400", async () => {
    const tab = browser();
    await tab.get("/sign-in");
    for (const ticket of ["", "x".repeat(10), 42]) {
      expect((await tab.post("/sign-in/redeem", { ticket })).status).toBe(400);
    }
    expect((await tab.post("/sign-in/redeem", { ticket: "a", extra: 1 })).status).toBe(400);
  });

  test("door.redeem_other_member: another member's ticket in the same browser never gets the first one's device or key", async () => {
    const tab = browser();
    const alice = await member();
    const bob = await member();
    const a = (await (await tab.post("/sign-in/redeem", { ticket: await tab.hop(alice) })).json()) as Record<
      string,
      string
    >;
    const b = (await (await tab.post("/sign-in/redeem", { ticket: await tab.hop(bob, BOB) })).json()) as Record<
      string,
      string
    >;
    expect(b.deviceId).not.toBe(a.deviceId);
    expect(b.storageKey).not.toBe(a.storageKey);
    expect(b.userId).toBe(`@${bob}:staging.unset.cc`);
    expect(await rowsOf(ALICE)).toEqual([a.deviceId]);
    expect(activeOn(a.deviceId ?? "")).toHaveLength(1);
  });

  test("door.redeem_chat_admin_down: MAS down or chat-admin gone is 503 chat.unavailable, nothing written", async () => {
    const user = await member();
    const tab = browser();
    mas.down = true;
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) });
    expect([res.status, await res.json()]).toEqual([503, { error: "chat.unavailable" }]);
    mas.down = false;
    await service.close();
    const gone = await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) });
    expect([gone.status, await gone.json()]).toEqual([503, { error: "chat.unavailable" }]);
    expect(await rowsOf(ALICE)).toEqual([]);
    service = await startService(mas);
  });

  test("door.redeem_logs_nothing_personal: no ticket, token, lock key, chat user or DID in a log line", async () => {
    const user = await member();
    const tab = browser();
    const ticket = await tab.hop(user);
    const body = (await (await tab.post("/sign-in/redeem", { ticket })).json()) as Record<string, string>;
    const text = logs.join("\n");
    for (const secret of [ticket, body.accessToken, body.storageKey, user, ALICE, body.deviceId]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("POST /sign-out", () => {
  async function signedIn() {
    const tab = browser();
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(await member()) });
    return { tab, session: (await res.json()) as Record<string, string> };
  }

  test("door.sign_out_wipes: the device is revoked, the entry and its key deleted, the cookie cleared", async () => {
    const { tab, session } = await signedIn();
    const res = await tab.post("/sign-out", { deviceId: session.deviceId });
    expect([res.status, await res.json()]).toEqual([200, { signedOut: true }]);
    expect(activeOn(session.deviceId ?? "")).toEqual([]);
    expect(await rowsOf(ALICE)).toEqual([]);
    expect(tab.jar.has("__Host-chat-browser")).toBe(false);
  });

  test("door.sign_out_no_cookie: without the door's cookie it is 401 and nothing is revoked", async () => {
    const { tab, session } = await signedIn();
    tab.jar.clear();
    const res = await tab.post("/sign-out", { deviceId: session.deviceId });
    expect([res.status, await res.json()]).toEqual([401, { error: "chat.no_session" }]);
    expect(activeOn(session.deviceId ?? "")).toHaveLength(1);
  });

  test("door.sign_out_other_browser: another browser naming this device revokes nothing", async () => {
    const { session } = await signedIn();
    const other = await signedIn();
    expect((await other.tab.post("/sign-out", { deviceId: session.deviceId })).status).toBe(200);
    expect(activeOn(session.deviceId ?? "")).toHaveLength(1);
    expect(await rowsOf(ALICE)).toHaveLength(2);
  });

  test("door.sign_out_wrong_origin: a cross-site post is refused by the CSRF gate", async () => {
    const { tab, session } = await signedIn();
    const res = await tab.post("/sign-out", { deviceId: session.deviceId }, "https://unset.sh");
    expect([res.status, await res.json()]).toEqual([403, { error: "csrf.denied" }]);
    expect(activeOn(session.deviceId ?? "")).toHaveLength(1);
  });

  test("door.sign_out_down: with chat-admin down it is 503 and the entry stays for another try", async () => {
    const { tab, session } = await signedIn();
    mas.down = true;
    const res = await tab.post("/sign-out", { deviceId: session.deviceId });
    expect([res.status, await res.json()]).toEqual([503, { error: "chat.unavailable" }]);
    expect(await rowsOf(ALICE)).toEqual([session.deviceId]);
    expect(tab.jar.has("__Host-chat-browser")).toBe(true);
  });

  test("door.sign_out_then_new_device: the next sign-in after Log out gets a new device and a new key", async () => {
    const { tab, session } = await signedIn();
    await tab.post("/sign-out", { deviceId: session.deviceId });
    const next = (await (
      await tab.post("/sign-in/redeem", { ticket: await tab.hop(await member()) })
    ).json()) as Record<string, string>;
    expect(next.deviceId).not.toBe(session.deviceId);
    expect(next.storageKey).not.toBe(session.storageKey);
  });

  test("door.sign_out_bad_device: a device ID of the wrong form is 400", async () => {
    const { tab } = await signedIn();
    expect((await tab.post("/sign-out", { deviceId: "../x" })).status).toBe(400);
  });
});

describe("POST /sign-out/redeem (unset.sh's Log out; ADR 0095 decision 5)", () => {
  // web's role, to queue the end as POST /logout does and to see whether the claim keeps it (migration 0050).
  const webDb = createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
    service: "door-test-web",
    max: 1,
    connectTimeoutMs: 5000,
  });
  afterAll(() => webDb.end());

  /** A browser signed in from a web session of its own, which the test may end as POST /logout does. */
  async function signedIn(did = ALICE, account?: ChatUser) {
    const tab = browser();
    const user = account ?? (await member());
    const sid = sessionRef(randomBytes(32));
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(user, did, undefined, sid) });
    return { tab, user, sid, session: (await res.json()) as Record<string, string> };
  }
  /** What POST /logout signs: session.mint for the ended session `sid`, with a one-time value no browser holds. */
  const logoutTicket = (user: ChatUser, sid: SessionRef, did = ALICE, now?: () => number) =>
    web(now).signTicket({ user, did, sid, state: randomBytes(32).toString("base64url") as DoorState });

  test("door.sign_out_redeem: this browser's own device and lock key, with a fresh token and no new device", async () => {
    const { tab, user, sid, session } = await signedIn();
    const res = await tab.post("/sign-out/redeem", { ticket: await logoutTicket(user, sid) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["accessToken", "deviceId", "expiresAt", "storageKey", "userId"]);
    expect([body.deviceId, body.storageKey, body.userId]).toEqual([
      session.deviceId,
      session.storageKey,
      session.userId,
    ]);
    expect(body.accessToken).not.toBe(session.accessToken);
    expect(activeOn(session.deviceId ?? "")).toHaveLength(1);
    expect(await rowsOf(ALICE)).toEqual([session.deviceId]);
  });

  test("door.sign_out_redeem_keeps_the_end: the entry is not renewed, so the end web queued still fires", async () => {
    const { tab, user, sid, session } = await signedIn();
    await withClient(webDb, null, (c) => c.query("SELECT app.end_chat_sessions($1::text[], NULL, 0)", [[sid]]));
    expect((await tab.post("/sign-out/redeem", { ticket: await logoutTicket(user, sid) })).status).toBe(200);
    const claimed = await withClient(webDb, null, (c) =>
      c.query<{ device_id: string }>("SELECT device_id FROM app.claim_chat_session_end(100, 60)"),
    );
    expect(claimed.rows.map((r) => r.device_id)).toContain(session.deviceId);
  });

  test("door.sign_out_redeem_no_ticket: a body without web's ticket is 400 and mints nothing", async () => {
    const { tab } = await signedIn();
    for (const body of [{}, { ticket: "" }, { ticket: "x".repeat(10) }, { ticket: "a", extra: 1 }]) {
      const res = await tab.post("/sign-out/redeem", body);
      expect([res.status, await res.json()]).toEqual([400, { error: "chat.bad_ticket" }]);
    }
    expect(mas.sessions.filter((s) => !s.revoked)).toHaveLength(1);
  });

  test("door.sign_out_redeem_used: a ticket spent once is refused by chat-admin the second time", async () => {
    const { tab, user, sid } = await signedIn();
    const ticket = await logoutTicket(user, sid);
    expect((await tab.post("/sign-out/redeem", { ticket })).status).toBe(200);
    const minted = mas.sessions.length;
    const again = await tab.post("/sign-out/redeem", { ticket });
    expect([again.status, await again.json()]).toEqual([403, { error: "chat.ticket_refused" }]);
    expect(mas.sessions).toHaveLength(minted);
  });

  test("door.sign_out_redeem_expired: a ticket past its 60 seconds is refused before chat-admin", async () => {
    const { tab, user, sid } = await signedIn();
    const minted = mas.sessions.length;
    const res = await tab.post("/sign-out/redeem", {
      ticket: await logoutTicket(user, sid, ALICE, () => Date.now() - 120_000),
    });
    expect([res.status, await res.json()]).toEqual([403, { error: "chat.ticket_expired" }]);
    expect(mas.sessions).toHaveLength(minted);
  });

  test("door.sign_out_redeem_other_browser: a browser without the member's entry gets nothing, and no device is made", async () => {
    const { session, user, sid } = await signedIn();
    const ticket = await logoutTicket(user, sid);
    // No door cookie at all.
    const stranger = browser();
    const bare = await stranger.post("/sign-out/redeem", { ticket });
    expect([bare.status, await bare.json()]).toEqual([401, { error: "chat.no_session" }]);
    // A browser that holds another member's entry only.
    const other = await signedIn(BOB);
    const minted = mas.sessions.length;
    const res = await other.tab.post("/sign-out/redeem", { ticket: await logoutTicket(user, sid) });
    expect([res.status, await res.json()]).toEqual([401, { error: "chat.no_session" }]);
    expect(mas.sessions).toHaveLength(minted);
    expect(await rowsOf(ALICE)).toEqual([session.deviceId]);
    expect(stranger.jar.has("__Host-chat-browser")).toBe(false);
  });

  test("door.sign_out_redeem_other_session: a ticket for the member's session in another browser is refused here", async () => {
    const here = await signedIn();
    const there = await signedIn(ALICE, here.user);
    const minted = mas.sessions.length;
    const res = await here.tab.post("/sign-out/redeem", { ticket: await logoutTicket(here.user, there.sid) });
    expect([res.status, await res.json()]).toEqual([403, { error: "chat.ticket_refused" }]);
    expect(mas.sessions).toHaveLength(minted);
    expect((await rowsOf(ALICE)).sort()).toEqual([here.session.deviceId, there.session.deviceId].sort());
  });

  test("door.sign_out_redeem_cross_site: a post from another site is refused by the CSRF gate before anything is read", async () => {
    const { tab, user, sid } = await signedIn();
    const minted = mas.sessions.length;
    const res = await tab.post("/sign-out/redeem", { ticket: await logoutTicket(user, sid) }, "https://unset.sh");
    expect([res.status, await res.json()]).toEqual([403, { error: "csrf.denied" }]);
    expect(mas.sessions).toHaveLength(minted);
  });

  test("door.sign_out_redeem_ended: a device already ended is 409 and its entry and key go", async () => {
    const { tab, user, sid } = await signedIn();
    for (const s of mas.sessions) s.revoked = true;
    const res = await tab.post("/sign-out/redeem", { ticket: await logoutTicket(user, sid) });
    expect([res.status, await res.json()]).toEqual([409, { error: "chat.device_ended" }]);
    expect(await rowsOf(ALICE)).toEqual([]);
  });

  test("door.sign_out_redeem_down: chat-admin unreachable is 503 and the entry stays for the queued end", async () => {
    const { tab, user, sid, session } = await signedIn();
    mas.down = true;
    const res = await tab.post("/sign-out/redeem", { ticket: await logoutTicket(user, sid) });
    expect([res.status, await res.json()]).toEqual([503, { error: "chat.unavailable" }]);
    expect(await rowsOf(ALICE)).toEqual([session.deviceId]);
  });
});

describe("POST /setup/claim and /setup/release", () => {
  /** A browser signed in to `user`'s account (a new member unless given). */
  async function signedIn(user?: ChatUser) {
    const tab = browser();
    const account = user ?? (await member());
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(account) });
    return { tab, user: account, deviceId: ((await res.json()) as { deviceId: string }).deviceId };
  }

  test("door.setup_one_browser: the first browser of an account claims setup, a second one is refused", async () => {
    const a = await signedIn();
    const b = await signedIn(a.user);
    const first = await a.tab.post("/setup/claim", { deviceId: a.deviceId });
    expect([first.status, await first.json()]).toEqual([200, { claimed: true }]);
    const second = await b.tab.post("/setup/claim", { deviceId: b.deviceId });
    expect([second.status, await second.json()]).toEqual([409, { error: "chat.setup_elsewhere" }]);
    expect((await a.tab.post("/setup/claim", { deviceId: a.deviceId })).status).toBe(200);
  });

  test("door.setup_release: after the holder's release the other browser may claim", async () => {
    const a = await signedIn();
    const b = await signedIn(a.user);
    await a.tab.post("/setup/claim", { deviceId: a.deviceId });
    const released = await a.tab.post("/setup/release", { deviceId: a.deviceId });
    expect([released.status, await released.json()]).toEqual([200, { released: true }]);
    expect((await b.tab.post("/setup/claim", { deviceId: b.deviceId })).status).toBe(200);
  });

  test("door.setup_denied: no cookie, another browser's device or a cross-site post claims nothing", async () => {
    const a = await signedIn();
    const other = await signedIn();
    const stranger = await other.tab.post("/setup/claim", { deviceId: a.deviceId });
    expect([stranger.status, await stranger.json()]).toEqual([401, { error: "chat.no_session" }]);
    const strangerRelease = await other.tab.post("/setup/release", { deviceId: a.deviceId });
    expect(strangerRelease.status).toBe(401);
    const crossSite = await a.tab.post("/setup/claim", { deviceId: a.deviceId }, "https://unset.sh");
    expect([crossSite.status, await crossSite.json()]).toEqual([403, { error: "csrf.denied" }]);
    expect((await a.tab.post("/setup/claim", { deviceId: "../x" })).status).toBe(400);
    a.tab.jar.clear();
    expect((await a.tab.post("/setup/claim", { deviceId: a.deviceId })).status).toBe(401);
    const claims = await withClient(db, null, (c) =>
      c.query("SELECT 1 FROM door.chat_setup WHERE chat_user = $1", [a.user]),
    );
    expect(claims.rowCount).toBe(0);
  });
});

test("door.browser_key_is_hashed: the stored browser is sha256 of the cookie, never the cookie", async () => {
  const user = await member();
  const tab = browser();
  await tab.post("/sign-in/redeem", { ticket: await tab.hop(user) });
  const cookie = Buffer.from(tab.jar.get("__Host-chat-browser") ?? "", "base64url");
  const stored = await withClient(db, null, async (c) => {
    const { rows } = await c.query<{ h: string }>(
      "SELECT encode(browser_hash, 'hex') AS h FROM door.browser WHERE did = $1",
      [ALICE],
    );
    return rows.map((r) => r.h);
  });
  expect(stored).toEqual([createHash("sha256").update(cookie).digest("hex")]);
});

describe("the chat count (ADR 0094, ADR 0101)", () => {
  const NOTIFY = "/_matrix/push/v1/notify";
  async function signedIn(did = ALICE) {
    const tab = browser();
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(await member(), did) });
    return { tab, deviceId: ((await res.json()) as { deviceId: string }).deviceId };
  }
  /** What Synapse 1.165.0 posts for an event (httppusher.py dispatch_push_event, format event_id_only). */
  const event = (pushkey: string, unread: number) => ({
    notification: {
      event_id: "$e",
      room_id: "!r:staging.unset.cc",
      prio: "high",
      counts: { unread },
      devices: [{ app_id: "sh.unset.chat", pushkey, pushkey_ts: 1, data: { format: "event_id_only" } }],
    },
  });
  /** Its badge-only update after a read receipt (httppusher.py _send_badge). */
  const badge = (pushkey: string, unread: number) => ({
    notification: {
      id: "",
      type: null,
      sender: "",
      counts: { unread },
      devices: [{ app_id: "sh.unset.chat", pushkey, pushkey_ts: 1, data: { format: "event_id_only" } }],
    },
  });
  const internal = (path: string, init: RequestInit = {}) =>
    door.count.handle(new Request(`http://chat-auth:8091${path}`, init));
  const notify = (body: unknown) =>
    internal(NOTIFY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const countOf = async (did: Did) => (await (await internal(`/count?did=${did}`)).json()) as { unread: unknown };

  test("door.push_key_issued: a signed-in browser gets a key and the internal notify address", async () => {
    const { tab, deviceId } = await signedIn();
    const res = await tab.post("/push/key", { deviceId });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["pushkey", "url"]);
    expect(body.pushkey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.url).toBe(`http://chat-auth:8091${NOTIFY}`);
  });

  test("door.push_key_denied: no cookie, another browser's device, a bad body or a cross-site post gets no key", async () => {
    const { tab, deviceId } = await signedIn();
    const other = await signedIn(BOB);
    const stranger = await other.tab.post("/push/key", { deviceId });
    expect([stranger.status, await stranger.json()]).toEqual([401, { error: "chat.no_session" }]);
    const crossSite = await tab.post("/push/key", { deviceId }, "https://unset.sh");
    expect([crossSite.status, await crossSite.json()]).toEqual([403, { error: "csrf.denied" }]);
    expect((await tab.post("/push/key", { deviceId: "../x" })).status).toBe(400);
    expect((await tab.post("/push/key", { deviceId, extra: 1 })).status).toBe(400);
    tab.jar.clear();
    expect((await tab.post("/push/key", { deviceId })).status).toBe(401);
    const rows = await withClient(db, null, (c) => c.query("SELECT 1 FROM door.push"));
    expect(rows.rowCount).toBe(0);
  });

  const setUpOf = async (did: string) => {
    const res = await internal(`/set-up?${new URLSearchParams({ did })}`);
    return [res.status, await res.json()];
  };

  test("door.set_up: web's onboarding read says a member is set up once a browser of theirs took a key", async () => {
    const { tab, deviceId } = await signedIn();
    expect(await setUpOf(ALICE)).toEqual([200, { setUp: false }]);
    await tab.post("/push/key", { deviceId });
    expect(await setUpOf(ALICE)).toEqual([200, { setUp: true }]);
    expect(await setUpOf(BOB)).toEqual([200, { setUp: false }]);
  });

  test("door.set_up_strict: a bad or repeated DID is 400, a POST 405, and the public door does not serve it", async () => {
    const { tab } = await signedIn();
    expect((await internal("/set-up?did=nope")).status).toBe(400);
    expect((await internal(`/set-up?did=${ALICE}&did=${BOB}`)).status).toBe(400);
    expect((await internal(`/set-up?did=${ALICE}&x=1`)).status).toBe(400);
    expect((await internal(`/set-up?did=${ALICE}`, { method: "POST" })).status).toBe(405);
    expect((await tab.get(`/set-up?did=${ALICE}`)).status).toBe(404);
  });

  test("door.count_rises_and_falls: an event's number and a read's badge update reach web's read", async () => {
    const { tab, deviceId } = await signedIn();
    const { pushkey } = (await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string };
    expect(await countOf(ALICE)).toEqual({ unread: null });
    const pushed = await notify(event(pushkey, 2));
    expect([pushed.status, await pushed.json()]).toEqual([200, { rejected: [] }]);
    expect(await countOf(ALICE)).toEqual({ unread: 2 });
    expect((await notify(badge(pushkey, 0))).status).toBe(200);
    expect(await countOf(ALICE)).toEqual({ unread: 0 });
    expect(await countOf(BOB)).toEqual({ unread: null });
  });

  test("door.notify_rejects_unknown: a key the door never issued, or one replaced, is rejected", async () => {
    const { tab, deviceId } = await signedIn();
    const first = ((await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string }).pushkey;
    await tab.post("/push/key", { deviceId });
    const unknown = randomBytes(32).toString("base64url");
    for (const key of [first, unknown]) {
      const res = await notify(event(key, 5));
      expect([res.status, await res.json()]).toEqual([200, { rejected: [key] }]);
    }
    expect(await countOf(ALICE)).toEqual({ unread: null });
  });

  test("door.notify_strict: a body that is not the push gateway's shape is 400 and records nothing", async () => {
    const { tab, deviceId } = await signedIn();
    const { pushkey } = (await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string };
    const good = event(pushkey, 1);
    const bad: unknown[] = [
      {},
      { ...good, extra: 1 },
      { notification: { ...good.notification, devices: [] } },
      { notification: { ...good.notification, devices: [{ pushkey: 7 }] } },
      { notification: { ...good.notification, counts: { unread: -1 } } },
      { notification: { ...good.notification, counts: { unread: 1.5 } } },
      { notification: { ...good.notification, counts: "1" } },
    ];
    for (const body of bad) expect((await notify(body)).status).toBe(400);
    const notJson = await internal(NOTIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect(await countOf(ALICE)).toEqual({ unread: null });
    expect((await internal("/count?did=nope")).status).toBe(400);
    expect((await internal(NOTIFY)).status).toBe(405);
  });

  test("door.count_port_apart: the public door answers neither route; the internal one serves no public route", async () => {
    const { tab, deviceId } = await signedIn();
    const { pushkey } = (await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string };
    expect((await tab.post(NOTIFY, event(pushkey, 3))).status).toBe(404);
    expect((await tab.get(`/count?did=${ALICE}`)).status).toBe(404);
    expect(await countOf(ALICE)).toEqual({ unread: null });
    for (const path of ["/", "/sign-in", "/health", "/push/key"]) expect((await internal(path)).status).toBe(404);
  });

  test("door.count_listeners: on real sockets the public port refuses the notify path and the count port takes it", async () => {
    const { tab, deviceId } = await signedIn();
    const { pushkey } = (await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string };
    const servers = [createServer(door.listener), createServer(door.count.listener)];
    const ports = await Promise.all(
      servers.map(
        (s) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port))),
      ),
    );
    try {
      const body = JSON.stringify(event(pushkey, 4));
      const post = (port: number) =>
        fetch(`http://127.0.0.1:${port}${NOTIFY}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
      // The public listener refuses it (421 for this Host, 404 under the door's own) and records nothing.
      expect([404, 421]).toContain((await post(ports[0] ?? 0)).status);
      expect(await countOf(ALICE)).toEqual({ unread: null });
      expect((await post(ports[1] ?? 0)).status).toBe(200);
      expect(await countOf(ALICE)).toEqual({ unread: 4 });
    } finally {
      for (const s of servers) s.close();
    }
  });

  test("door.push_key_goes_at_sign_out: after Log out the key is rejected and the count is gone", async () => {
    const { tab, deviceId } = await signedIn();
    const { pushkey } = (await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string };
    await notify(event(pushkey, 2));
    await tab.post("/sign-out", { deviceId });
    expect(await (await notify(event(pushkey, 2))).json()).toEqual({ rejected: [pushkey] });
    expect(await countOf(ALICE)).toEqual({ unread: null });
  });

  test("door.count_logs_nothing_personal: no DID, pushkey or number in a log line", async () => {
    const { tab, deviceId } = await signedIn();
    const { pushkey } = (await (await tab.post("/push/key", { deviceId })).json()) as { pushkey: string };
    logs.length = 0;
    await notify(event(pushkey, 31337));
    await countOf(ALICE);
    const text = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [pushkey, ALICE, "31337"]) expect(text).not.toContain(secret);
  });
});

describe("the Message link (ADR 0094 decision 6, ADR 0101 decision 3)", () => {
  const as = (role: "web" | "indexer") =>
    createPool({
      connection: { host: provided.host, port: provided.port, ...provided.roles[role], database, ssl: false },
      service: `door-test-${role}`,
      max: 1,
      connectTimeoutMs: 5000,
    });
  const [webDb, indexerDb] = [as("web"), as("indexer")];
  afterAll(() => Promise.all([webDb.end(), indexerDb.end()]));
  /** A member with a ready chat account and, unless `shown` is false, a public page; their DID and chat user. */
  async function contact(shown = true, name = "N") {
    const did =
      `did:plc:${Array.from(randomBytes(24), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("")}` as Did;
    const user = newChatUser((k) => randomBytes(k));
    await withClient(webDb, null, async (c) => {
      await c.query("INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ($1, now(), 'done')", [did]);
      await c.query("INSERT INTO app.chat_account (did, chat_user) VALUES ($1, $2)", [did, user]);
      await c.query("UPDATE app.chat_account SET state = 'ready' WHERE did = $1", [did]);
    });
    await withClient(indexerDb, null, async (c) => {
      await c.query("INSERT INTO idx.account (did, updated_at) VALUES ($1, now())", [did]);
      await c.query("UPDATE idx.account SET pds_active = $2 WHERE did = $1", [did, shown]);
      await c.query(
        `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
         VALUES ($1, $2, 'cid', '3l', '{}', $3, false, now())`,
        [did, `at://${did}/sh.unset.profile/self`, name],
      );
    });
    return { did, user };
  }
  async function signedIn() {
    const tab = browser();
    const res = await tab.post("/sign-in/redeem", { ticket: await tab.hop(await member()) });
    return { tab, deviceId: ((await res.json()) as { deviceId: string }).deviceId };
  }

  test("door.dm_page: /dm/<did> serves the chat page, which hops and comes back to it", async () => {
    const tab = browser();
    const { did } = await contact();
    const res = await tab.get(`/dm/${did}`);
    expect([res.status, res.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
    const hop = await tab.get(`/sign-in?return=${encodeURIComponent(`/dm/${did}`)}`);
    expect(hop.status).toBe(303);
    expect((await tab.get("/dm/not-a-did")).status).toBe(404);
  });

  test("door.chat_id_found: a signed-in browser gets the chat ID of a member whose page shows", async () => {
    const { tab, deviceId } = await signedIn();
    const { did, user } = await contact();
    const res = await tab.post("/chat-id", { deviceId, did });
    expect([res.status, await res.json()]).toEqual([200, { chatId: `@${user}:staging.unset.cc` }]);
  });

  test("door.chat_id_missing: a hidden member and one with no chat both read as the same 404", async () => {
    const { tab, deviceId } = await signedIn();
    const hidden = await contact(false);
    for (const did of [hidden.did, `did:plc:${"z".repeat(24)}`]) {
      const res = await tab.post("/chat-id", { deviceId, did });
      expect([res.status, await res.json()]).toEqual([404, { error: "chat.not_found" }]);
    }
  });

  test("door.chat_id_denied: no cookie, another browser's device, a bad body or a cross-site post learns nothing", async () => {
    const { tab, deviceId } = await signedIn();
    const other = browser();
    const { did } = await contact();
    for (const res of [
      await other.post("/chat-id", { deviceId, did }),
      await tab.post("/chat-id", { deviceId, did }, "https://unset.sh"),
      await tab.post("/chat-id", { deviceId, did: "nope" }),
      await tab.post("/chat-id", { deviceId, did, extra: 1 }),
      await tab.post("/chat-id", { did }),
    ]) {
      expect([400, 401, 403]).toContain(res.status);
      expect(JSON.stringify(await res.json())).not.toContain("@u");
    }
    expect((await other.post("/chat-id", { deviceId, did })).status).toBe(401);
  });

  test("door.chat_name_found: a signed-in browser gets the public name of a member whose page shows", async () => {
    const { tab, deviceId } = await signedIn();
    const { user } = await contact(true, "Bea Ramos");
    const res = await tab.post("/chat-name", { deviceId, chatId: `@${user}:staging.unset.cc` });
    expect([res.status, await res.json()]).toEqual([200, { name: "Bea Ramos" }]);
  });

  test("door.chat_name_missing: a hidden member and an unknown chat ID both read as the same 404", async () => {
    const { tab, deviceId } = await signedIn();
    const hidden = await contact(false, "Hidden Name");
    for (const user of [hidden.user, `u${"z".repeat(20)}`]) {
      const res = await tab.post("/chat-name", { deviceId, chatId: `@${user}:staging.unset.cc` });
      expect([res.status, await res.json()]).toEqual([404, { error: "chat.not_found" }]);
    }
  });

  test("door.chat_name_denied: no cookie, another browser's device, another server, a bad body or a cross-site post learn nothing", async () => {
    const { tab, deviceId } = await signedIn();
    const other = browser();
    const { user } = await contact(true, "Bea Ramos");
    const chatId = `@${user}:staging.unset.cc`;
    for (const res of [
      await other.post("/chat-name", { deviceId, chatId }),
      await tab.post("/chat-name", { deviceId, chatId }, "https://unset.sh"),
      await tab.post("/chat-name", { deviceId, chatId: `@${user}:elsewhere.example` }),
      await tab.post("/chat-name", { deviceId, chatId: user }),
      await tab.post("/chat-name", { deviceId, chatId, extra: 1 }),
      await tab.post("/chat-name", { chatId }),
    ]) {
      expect([400, 401, 403]).toContain(res.status);
      expect(JSON.stringify(await res.json())).not.toContain("Bea");
    }
    expect((await other.post("/chat-name", { deviceId, chatId })).status).toBe(401);
  });

  test("door.chat_id_logs_nothing_personal: no DID, chat user or name in a log line", async () => {
    const { tab, deviceId } = await signedIn();
    const { did, user } = await contact(true, "Logged Name");
    logs.length = 0;
    await tab.get(`/dm/${did}`);
    await tab.post("/chat-id", { deviceId, did });
    await tab.post("/chat-name", { deviceId, chatId: `@${user}:staging.unset.cc` });
    const text = logs.join("\n");
    for (const secret of [did, user, "Logged Name"]) expect(text).not.toContain(secret);
  });
});
