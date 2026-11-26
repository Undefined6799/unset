// chat-admin's three commands against a fake MAS (ADR 0093 decision 1 and 5): create account, mint session (a new
// device or a renewal), end sessions; plus replay, quotas, failure answers and what reaches the log.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createQuotas } from "../../../interfaces/chat-admin/quota.ts";
import {
  ALICE,
  CLIENT_ID,
  CLIENT_SECRET,
  type FakeMas,
  fakeMas,
  payloadFor,
  SCOPE_PREFIX,
  signed,
  startService,
} from "./harness.ts";

let mas: FakeMas;
let service: Awaited<ReturnType<typeof startService>>;
beforeEach(async () => {
  mas = await fakeMas();
  service = await startService(mas);
});
afterEach(async () => {
  await service.close();
  await mas.close();
});

const create = (overrides = {}) =>
  service.post(
    "/v1/account.create",
    signed(service.web, payloadFor({ verb: "account.create", name: "alice.unset.sh", ...overrides })),
  );
const mint = (device: string | null = null, overrides = {}) =>
  service.post("/v1/session.mint", { ticket: signed(service.web, payloadFor(overrides)), device });
const end = (device: string, key = service.web) =>
  service.post("/v1/session.end", signed(key, payloadFor({ verb: "session.end", device })));
const mintCalls = () => mas.seen.filter((s) => s.method === "POST" && s.path === "/api/admin/v1/personal-sessions");
const DEVICE = /^[A-Z0-9]{10}$/;

describe("account.create", () => {
  test("create.happy_path: MAS gets the username and display name, with a client-credentials admin token", async () => {
    const res = await create();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: true });
    expect(mas.users.get(ALICE)?.displayname).toBe("alice.unset.sh");
    const token = mas.seen.find((s) => s.path === "/oauth2/token");
    expect(token?.auth).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`);
    expect(new URLSearchParams(token?.body).get("scope")).toBe("urn:mas:admin");
  });

  test("create.retry_is_harmless: a second create for the same account answers created false", async () => {
    await create();
    const res = await create();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: false });
  });

  test("create.reserved: a name MAS refuses that no user holds is 409 username_taken", async () => {
    mas.reserved.add(ALICE);
    const res = await create();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "username_taken" });
  });
});

describe("session.mint", () => {
  beforeEach(async () => {
    await create();
  });

  test("mint.new_device: the constant scope, a fresh 10-character device, expires_in always set", async () => {
    const res = await mint();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; device: string; expiresIn: number };
    expect(body.device).toMatch(DEVICE);
    expect(body.expiresIn).toBe(3600);
    expect(body.token).toMatch(/^mpt_/);
    const sent = JSON.parse(mintCalls()[0]?.body ?? "{}") as Record<string, unknown>;
    expect(sent).toEqual({
      actor_user_id: mas.users.get(ALICE)?.id,
      human_name: "unset.cc",
      scope: `${SCOPE_PREFIX}${body.device}`,
      expires_in: 3600,
    });
  });

  test("mint.never_reuses: a generated device ID that ever had a session is replaced by another", async () => {
    let first = true;
    mas.onList = (url) => {
      if (!first) return;
      first = false;
      const scope = url.searchParams.get("filter[scope]") ?? "";
      const actor = url.searchParams.get("filter[actor_user]") ?? "";
      mas.sessions.push({
        id: "0".repeat(26),
        actor,
        scope: `urn:matrix:client:api:* ${scope}`,
        revoked: true,
        expiresIn: 1,
        humanName: "x",
        token: "",
      });
    };
    const body = (await (await mint()).json()) as { device: string };
    const taken = mas.sessions[0]?.scope.split(":").at(-1);
    expect(body.device).toMatch(DEVICE);
    expect(body.device).not.toBe(taken);
  });

  test("mint.renew_mints_before_revoking: same device, the new session first, then the old one revoked", async () => {
    const { device } = (await (await mint()).json()) as { device: string };
    const res = await mint(device);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { device: string }).device).toBe(device);
    const order = mas.seen.filter((s) => s.method === "POST" && s.path.startsWith("/api/admin/v1/personal-sessions"));
    expect(order.map((s) => (s.path.endsWith("/revoke") ? "revoke" : "mint"))).toEqual(["mint", "mint", "revoke"]);
    const live = mas.sessions.filter((s) => !s.revoked);
    expect(live).toHaveLength(1);
    expect(live[0]?.scope).toBe(`${SCOPE_PREFIX}${device}`);
  });

  test("mint.ended_device_is_never_revived: renewing a device with no live session is 409 and mints nothing", async () => {
    const { device } = (await (await mint()).json()) as { device: string };
    expect((await end(device)).status).toBe(200);
    const before = mintCalls().length;
    const res = await mint(device);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "device_ended" });
    expect(mintCalls()).toHaveLength(before);
  });

  test("mint.renew_device_format: a device that is not 10 of A-Z0-9 is refused before any MAS call", async () => {
    const before = mas.seen.length;
    expect((await mint("abc")).status).toBe(400);
    expect(mas.seen).toHaveLength(before);
  });

  test("mint.no_account and mint.locked: refused, nothing minted", async () => {
    expect((await mint(null, { user: "bob00000000000000000000" })).status).toBe(409);
    const alice = mas.users.get(ALICE);
    if (alice) alice.locked = true;
    expect((await mint()).status).toBe(403);
    expect(mintCalls()).toHaveLength(0);
  });
});

describe("session.end", () => {
  test("end.revokes_the_device: web or the door ends it, and a repeat is harmless", async () => {
    await create();
    const { device } = (await (await mint()).json()) as { device: string };
    const res = await end(device, service.door);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: 1 });
    expect(mas.sessions.every((s) => s.revoked)).toBe(true);
    expect(await (await end(device)).json()).toEqual({ ended: 0 });
  });
});

// ADR 0096 decisions 1 to 5: lock keeps sessions, unlock restores them, deactivate erases and ends them; each repeats
// harmlessly, and no route brings a deactivated account back.
const account = (verb: "account.lock" | "account.unlock" | "account.deactivate", user = ALICE, key = service.web) =>
  service.post(`/v1/${verb}`, signed(key, payloadFor({ verb, user })));

describe("account lifecycle", () => {
  beforeEach(async () => {
    await create();
  });

  test("lock.keeps_sessions: a locked account mints nothing new, its sessions stay, and a repeat is harmless", async () => {
    await mint();
    const res = await account("account.lock");
    expect([res.status, await res.json()]).toEqual([200, { locked: true }]);
    expect(mas.users.get(ALICE)?.locked).toBe(true);
    expect(mas.sessions.filter((s) => !s.revoked)).toHaveLength(1);
    expect((await mint()).status).toBe(403);
    expect((await account("account.lock")).status).toBe(200);
  });

  test("unlock.restores: the same device renews again after an unlock", async () => {
    const { device } = (await (await mint()).json()) as { device: string };
    await account("account.lock");
    const res = await account("account.unlock");
    expect([res.status, await res.json()]).toEqual([200, { locked: false }]);
    const renewed = await mint(device);
    expect(renewed.status).toBe(200);
    expect(((await renewed.json()) as { device: string }).device).toBe(device);
  });

  test("deactivate.erases: no body, so MAS asks the homeserver to erase; sessions end; a repeat is harmless", async () => {
    await mint();
    await account("account.lock");
    const res = await account("account.deactivate");
    expect([res.status, await res.json()]).toEqual([200, { deactivated: true }]);
    expect(mas.erased).toEqual([{ username: ALICE, body: "" }]);
    expect(mas.sessions.every((s) => s.revoked)).toBe(true);
    expect((await account("account.deactivate")).status).toBe(200);
    expect((await mint()).status).toBe(403);
  });

  test("deactivate.no_account: an account MAS never made is already gone", async () => {
    const res = await account("account.deactivate", "bob00000000000000000000");
    expect([res.status, await res.json()]).toEqual([200, { deactivated: false }]);
    expect(mas.erased).toEqual([]);
  });

  test("lock.no_account: an account MAS does not hold is 409 no_account", async () => {
    const res = await account("account.lock", "bob00000000000000000000");
    expect([res.status, await res.json()]).toEqual([409, { error: "no_account" }]);
  });

  test("lifecycle.web_only: the door's key may not lock, unlock or deactivate", async () => {
    for (const verb of ["account.lock", "account.unlock", "account.deactivate"] as const) {
      expect((await account(verb, ALICE, service.door)).status).toBe(403);
    }
    expect(mas.users.get(ALICE)).toMatchObject({ locked: false, deactivated: false });
  });

  test("lifecycle.no_reactivate: no route brings a deactivated account back", async () => {
    for (const path of ["/v1/account.reactivate", "/v1/user.reactivate"]) {
      expect((await service.post(path, signed(service.web, payloadFor({ verb: "account.deactivate" })))).status).toBe(
        404,
      );
    }
    expect(mas.seen.some((s) => s.path.endsWith("/reactivate"))).toBe(false);
  });
});

describe("refusals", () => {
  test("replay: the same envelope twice is 403 the second time, and MAS sees one mint", async () => {
    await create();
    const ticket = signed(service.web, payloadFor());
    expect((await service.post("/v1/session.mint", { ticket, device: null })).status).toBe(200);
    expect((await service.post("/v1/session.mint", { ticket, device: null })).status).toBe(403);
    expect(mintCalls()).toHaveLength(1);
  });

  test("route_must_match_verb: an end envelope posted to mint is refused", async () => {
    const ticket = signed(service.web, payloadFor({ verb: "session.end", device: "ABCDEFGHJK" }));
    expect((await service.post("/v1/session.mint", { ticket, device: null })).status).toBe(403);
  });

  test("routes: unknown path 404, wrong content type 400, a body over the cap 400", async () => {
    expect((await service.post("/v1/user.reactivate", {})).status).toBe(404);
    expect((await service.send(`${service.base}/v1/session.mint`, { method: "GET" })).status).toBe(404);
    expect((await service.post("/v1/session.mint", "{}", { "content-type": "text/plain" })).status).toBe(400);
    expect((await service.post("/v1/session.mint", "x".repeat(5000))).status).toBe(400);
  });

  test("quota: past the per-account mint quota the answer is 429 and MAS is not called", async () => {
    await service.close();
    service = await startService(mas, { quotas: createQuotas({ "session.mint": { perUser: 1, global: 100 } }) });
    await create();
    expect((await mint()).status).toBe(200);
    const before = mas.seen.length;
    expect((await mint()).status).toBe(429);
    expect(mas.seen).toHaveLength(before);
  });

  test("mas_down: 503, never 200", async () => {
    mas.down = true;
    expect((await mint()).status).toBe(503);
  });

  test("log.allowlisted: no username, display name, token or secret reaches the log", async () => {
    await create();
    const body = (await (await mint()).json()) as { token: string };
    await mint("ABCDEFGHJK");
    const text = JSON.stringify(service.logs);
    expect(service.logs.length).toBeGreaterThan(2);
    for (const secret of [ALICE, "alice.unset.sh", body.token, CLIENT_SECRET]) expect(text).not.toContain(secret);
    for (const line of service.logs) {
      expect(Object.keys(line).every((k) => ["outcome", "verb", "reason", "kid", "jti"].includes(k))).toBe(true);
    }
  });
});
