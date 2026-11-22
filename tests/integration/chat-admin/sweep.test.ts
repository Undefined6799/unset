// chat-admin's room sweep (ADR 0102) against fake MAS and Synapse admin APIs: what is deleted (a plain room, by list,
// state and ADR 0097's retention event, with no event for 30 days), what is never touched, the per-run session
// (constant scope, short expiry, revoked at the end), the fixed delete body, the command's fixed shape, and a log of
// counts only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openSweepCursor } from "../../../interfaces/chat-admin/sweep.ts";
import { createSynapse } from "../../../interfaces/chat-admin/synapse.ts";
import { DAY_MS, ENCRYPTED_STATE, type FakeSynapse, fakeSynapse, PLAIN_STATE } from "./fake-synapse.ts";
import { type FakeMas, fakeMas, nowSeconds, payloadFor, signed, startService, tempDir } from "./harness.ts";

let mas: FakeMas;
let synapse: FakeSynapse;
let service: Awaited<ReturnType<typeof startService>>;
beforeEach(async () => {
  mas = await fakeMas();
  synapse = await fakeSynapse(mas);
  service = await startService(mas, { synapse: createSynapse({ adminUrl: synapse.url }) });
});
afterEach(async () => {
  await service.close();
  await synapse.close();
  await mas.close();
});

const SWEEP = { verb: "rooms.sweep", user: "", did: "", sid: "", state: "" } as const;
const sweep = (overrides = {}, key = service.web) =>
  service.post("/v1/rooms.sweep", signed(key, payloadFor({ ...SWEEP, ...overrides })));
const old = () => Date.now() - 31 * DAY_MS;
const recent = () => Date.now() - 29 * DAY_MS;
const deletes = () => synapse.seen.filter((s) => s.method === "DELETE");
const sweeperSessions = () => mas.sessions.filter((s) => s.scope.includes("urn:synapse:admin:*"));

describe("rooms.sweep", () => {
  test("sweep.idle_plain_deleted: a plain room with no event for 30 days is deleted with purge and no block", async () => {
    synapse.rooms.set("!idle", { encryption: null, state: PLAIN_STATE, newest: old() });
    const res = await sweep();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ listed: 1, plain: 1, deleted: 1, kept: 0, failed: 0 });
    expect(deletes()).toEqual([expect.objectContaining({ path: "/_synapse/admin/v2/rooms/!idle" })]);
    expect(JSON.parse(deletes()[0]?.body ?? "")).toEqual({ block: false, purge: true });
    expect(synapse.rooms.has("!idle")).toBe(false);
  });

  test("sweep.never_touched: encrypted, encrypted by state, without retention, other lifetime and active stay", async () => {
    synapse.rooms.set("!enc", { encryption: "m.megolm.v1.aes-sha2", state: ENCRYPTED_STATE, newest: old() });
    // The list says plain but the state holds m.room.encryption: the state wins.
    synapse.rooms.set("!encstate", { encryption: null, state: [...PLAIN_STATE, ...ENCRYPTED_STATE], newest: old() });
    synapse.rooms.set("!noretention", { encryption: null, state: [PLAIN_STATE[0] as never], newest: old() });
    const other = { type: "m.room.retention", state_key: "", content: { max_lifetime: 1000 } };
    synapse.rooms.set("!lifetime", { encryption: null, state: [PLAIN_STATE[0] as never, other], newest: old() });
    synapse.rooms.set("!twice", {
      encryption: null,
      state: [...PLAIN_STATE, { ...other, state_key: "x" }],
      newest: old(),
    });
    synapse.rooms.set("!active", { encryption: null, state: PLAIN_STATE, newest: recent() });
    const res = await sweep();
    expect(await res.json()).toEqual({ listed: 6, plain: 1, deleted: 0, kept: 6, failed: 0 });
    expect(deletes()).toEqual([]);
    // The encrypted room's state is never even read: the list already rules it out.
    expect(synapse.seen.some((s) => s.path.includes(encodeURIComponent("!enc") + "/"))).toBe(false);
  });

  test("sweep.failure_keeps: a room whose state call fails is kept and counted failed; the rest go on", async () => {
    synapse.rooms.set("!broken", { encryption: null, state: PLAIN_STATE, newest: old() });
    synapse.rooms.set("!idle", { encryption: null, state: PLAIN_STATE, newest: old() });
    synapse.broken.add("!broken");
    const res = await sweep();
    expect(await res.json()).toMatchObject({ deleted: 1, failed: 1 });
    expect(synapse.rooms.has("!broken")).toBe(true);
  });

  test("sweep.failed_delete: a delete Synapse reports failed counts failed", async () => {
    synapse.rooms.set("!idle", { encryption: null, state: PLAIN_STATE, newest: old() });
    synapse.deletes = "failed";
    expect(await (await sweep()).json()).toMatchObject({ deleted: 0, failed: 1 });
  });

  test("sweep.pages: every page of the room list is read", async () => {
    synapse.pageSize = 2;
    for (const n of [1, 2, 3, 4, 5])
      synapse.rooms.set(`!idle${n}`, { encryption: null, state: PLAIN_STATE, newest: old() });
    expect(await (await sweep()).json()).toMatchObject({ listed: 5, deleted: 5 });
  });

  test("sweep.session: one session per run, constant scope, 120 s, for the service user, revoked at the end", async () => {
    synapse.rooms.set("!idle", { encryption: null, state: PLAIN_STATE, newest: old() });
    await sweep();
    const [session, ...more] = sweeperSessions();
    expect(more).toEqual([]);
    expect(session?.scope).toBe("urn:matrix:client:api:* urn:synapse:admin:*");
    expect(session?.expiresIn).toBe(120);
    expect(session?.actor).toBe(mas.users.get("unset-room-sweeper")?.id);
    expect(session?.revoked).toBe(true);
    // A second run reuses the service user and mints a new session.
    await sweep();
    expect(sweeperSessions()).toHaveLength(2);
    expect(mas.users.size).toBe(1);
  });

  test("sweep.revoked_on_failure: a Synapse that cannot be reached is 503, and the session is still revoked", async () => {
    await synapse.close();
    const res = await sweep();
    expect(res.status).toBe(503);
    expect(sweeperSessions().map((s) => s.revoked)).toEqual([true]);
  });

  test("sweep.inactive_sweeper: a locked service user is never given a session", async () => {
    await sweep();
    const sweeper = mas.users.get("unset-room-sweeper");
    if (sweeper) sweeper.locked = true;
    const res = await sweep();
    expect(res.status).toBe(503);
    expect(sweeperSessions()).toHaveLength(1);
  });

  test("sweep.fixed_shape: a user, a device or any other field is refused, and the door may not ask", async () => {
    for (const overrides of [{ user: "alice0000000000000000000" }, { device: "ABCDEFGHJK" }, { name: "x.unset.sh" }]) {
      expect((await sweep(overrides)).status).toBe(400);
    }
    expect((await sweep({}, service.door)).status).toBe(403);
    expect(mas.seen).toEqual([]);
  });

  test("sweep.room_list_refused: a body carrying a room list is not an envelope", async () => {
    const body = { ...signed(service.web, payloadFor(SWEEP)), rooms: ["!idle"] };
    expect((await service.post("/v1/rooms.sweep", body)).status).toBe(400);
  });

  test("sweep.expired_envelope: an envelope past its life is refused and nothing is deleted", async () => {
    synapse.rooms.set("!idle", { encryption: null, state: PLAIN_STATE, newest: old() });
    const iat = nowSeconds() - 58;
    await service.close();
    service = await startService(mas, {
      synapse: createSynapse({ adminUrl: synapse.url }),
      now: () => Date.now() + 5_000,
    });
    expect((await sweep({ iat, exp: iat + 60 })).status).toBe(403);
    expect(deletes()).toEqual([]);
  });

  test("sweep.run_budget: no work starts 25 seconds after the run began, well inside the envelope's life", async () => {
    for (let n = 0; n < 40; n++)
      synapse.rooms.set(`!idle${n}`, { encryption: null, state: PLAIN_STATE, newest: old() });
    await service.close();
    // Each reading of the clock moves it on one second, so the 60-second envelope would allow far more.
    let clock = Date.now();
    service = await startService(mas, {
      synapse: createSynapse({ adminUrl: synapse.url }),
      now: () => {
        clock += 1000;
        return clock;
      },
    });
    const counts = (await (await sweep()).json()) as { deleted: number };
    expect(counts.deleted).toBeGreaterThan(0);
    expect(counts.deleted).toBeLessThanOrEqual(10);
  });

  test("sweep.resumes: a run that stops early hands on where it stopped, so later rooms are reached", async () => {
    // 12 active plain rooms, then one idle room; the clock moves a second per reading, so one run checks only a few.
    synapse.pageSize = 4;
    for (let n = 0; n < 12; n++)
      synapse.rooms.set(`!active${String(n).padStart(2, "0")}`, {
        encryption: null,
        state: PLAIN_STATE,
        newest: recent(),
      });
    synapse.rooms.set("!zidle", { encryption: null, state: PLAIN_STATE, newest: old() });
    await service.close();
    let clock = Date.now();
    const options = {
      synapse: createSynapse({ adminUrl: synapse.url }),
      now: () => {
        clock += 1000;
        return clock;
      },
    };
    service = await startService(mas, options);
    const first = (await (await sweep()).json()) as { deleted: number };
    expect(first.deleted).toBe(0);
    let runs = 1;
    while (synapse.rooms.has("!zidle") && runs < 6) {
      // Each run starts on the real time again, so its envelope is still alive.
      clock = Date.now();
      expect((await sweep()).status).toBe(200);
      runs++;
    }
    expect(synapse.rooms.has("!zidle")).toBe(false);
  });

  test("sweep.resumes_within_page: a page longer than one run hands on its first unchecked room", async () => {
    // One page holds 2 idle rooms, 12 active ones, then the idle !zidle; a run checks only a few, so the point
    // handed on must lie inside the page, two earlier for the two rooms this run deleted before it.
    synapse.rooms.set("!aaidle0", { encryption: null, state: PLAIN_STATE, newest: old() });
    synapse.rooms.set("!aaidle1", { encryption: null, state: PLAIN_STATE, newest: old() });
    for (let n = 0; n < 12; n++)
      synapse.rooms.set(`!active${String(n).padStart(2, "0")}`, {
        encryption: null,
        state: PLAIN_STATE,
        newest: recent(),
      });
    synapse.rooms.set("!zidle", { encryption: null, state: PLAIN_STATE, newest: old() });
    const file = join(tempDir(), "sweep.cursor");
    await service.close();
    let clock = Date.now();
    service = await startService(mas, {
      synapse: createSynapse({ adminUrl: synapse.url }),
      sweepCursor: openSweepCursor(file),
      now: () => {
        clock += 1000;
        return clock;
      },
    });
    const first = (await (await sweep()).json()) as { deleted: number };
    expect(first.deleted).toBe(2);
    const handedOn = Number(readFileSync(file, "utf8").trim());
    // The rooms left at offsets below the point are the active ones this run checked, none skipped or repeated.
    const ids = [...synapse.rooms.keys()].sort();
    expect(handedOn).toBeGreaterThan(0);
    expect(ids.slice(0, handedOn).every((id) => id.startsWith("!active"))).toBe(true);
    let runs = 1;
    while (synapse.rooms.has("!zidle") && runs < 6) {
      clock = Date.now();
      expect((await sweep()).status).toBe(200);
      runs++;
    }
    expect(synapse.rooms.has("!zidle")).toBe(false);
  });

  test("sweep.resume_survives_restart: the resume point is kept in chat-admin's state folder", async () => {
    synapse.pageSize = 2;
    for (let n = 0; n < 12; n++)
      synapse.rooms.set(`!active${String(n).padStart(2, "0")}`, {
        encryption: null,
        state: PLAIN_STATE,
        newest: recent(),
      });
    synapse.rooms.set("!zidle", { encryption: null, state: PLAIN_STATE, newest: old() });
    const file = join(tempDir(), "sweep.cursor");
    let clock = Date.now();
    const options = () => ({
      synapse: createSynapse({ adminUrl: synapse.url }),
      sweepCursor: openSweepCursor(file),
      now: () => {
        clock += 1000;
        return clock;
      },
    });
    await service.close();
    service = await startService(mas, options());
    await sweep();
    const after = readFileSync(file, "utf8").trim();
    expect(Number(after)).toBeGreaterThan(0);
    // A new process reads the same point and starts there.
    await service.close();
    service = await startService(mas, options());
    clock = Date.now();
    expect((await sweep()).status).toBe(200);
    const fromList = synapse.seen.filter((s) => s.path.startsWith("/_synapse/admin/v1/rooms?"));
    expect(fromList.at(-1)?.path ?? "").not.toContain("from=0&");
  });

  test("sweep.logs_counts_only: the log carries counts and fixed words, never a room, user or token", async () => {
    synapse.rooms.set("!idle", { encryption: null, state: PLAIN_STATE, newest: old() });
    await sweep();
    const line = service.logs.at(-1);
    expect(line).toMatchObject({ outcome: "ok", verb: "rooms.sweep", deleted: 1, kept: 0, failed: 0 });
    const text = JSON.stringify(service.logs);
    for (const secret of ["!idle", "unset-room-sweeper", ...mas.sessions.map((s) => s.token)]) {
      expect(text).not.toContain(secret);
    }
  });
});
