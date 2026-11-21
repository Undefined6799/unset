// web's chat-admin client against chat-admin itself (build step 5; ADR 0081 decision 5): the envelope web signs passes
// every check chat-admin makes, through a real net-guard on loopback. MAS is the fake from harness.ts (an unmanaged
// dependency, TE-1).
import type { Handle } from "@unset/domains-identity";
import { type ChatUser, parseDoorState, sessionRef } from "@unset/domains-messaging";
import { createChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createSynapse } from "../../../interfaces/chat-admin/synapse.ts";
import { DAY_MS, ENCRYPTED_STATE, fakeSynapse, PLAIN_STATE } from "./fake-synapse.ts";
import { type FakeMas, fakeMas, startService } from "./harness.ts";

const USER = `u${"e".repeat(20)}` as ChatUser;
const NAME = "a.unset.name" as Handle;
const guard = createNetGuard({ internalHosts: [], allowLoopback: true, commit: "c".repeat(40) });

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

const clientFor = (key = service.web) =>
  createChatAdminClient(guard, { origin: service.base, env: "dev", key: { kid: key.kid, privateKey: key.privateKey } });

describe("web's chat-admin client", () => {
  test("chat.client_create_accepted: chat-admin creates the account web asked for, and a retry is still created", async () => {
    expect(await clientFor().createAccount(USER, NAME)).toEqual({ kind: "created" });
    expect(mas.users.get(USER)?.displayname).toBe(NAME);
    expect(await clientFor().createAccount(USER, NAME)).toEqual({ kind: "created" });
    expect(service.logs.filter((line) => line.outcome !== "ok")).toEqual([]);
  });

  test("chat.client_create_taken: a name MAS holds for nobody is taken, so the job stops", async () => {
    mas.reserved.add(USER);
    expect(await clientFor().createAccount(USER, NAME)).toEqual({ kind: "taken" });
  });

  test("chat.client_door_key_refused: a key chat-admin lets only end sessions cannot create", async () => {
    expect(await clientFor(service.door).createAccount(USER, NAME)).toEqual({ kind: "unavailable" });
    expect(mas.users.has(USER)).toBe(false);
  });

  test("chat.client_deactivate_erases: chat-admin deactivates the account web names, and a retry is harmless", async () => {
    await clientFor().createAccount(USER, NAME);
    expect(await clientFor().changeAccount(USER, "account.deactivate")).toEqual({ kind: "done" });
    expect(mas.erased).toEqual([{ username: USER, body: "" }]);
    expect(await clientFor().changeAccount(USER, "account.deactivate")).toEqual({ kind: "done" });
    expect(await clientFor(service.door).changeAccount(USER, "account.lock")).toEqual({ kind: "unavailable" });
  });

  test("chat.ticket_redeemed_once: the door's post of web's ticket mints one session, and a replay is refused", async () => {
    await clientFor().createAccount(USER, NAME);
    const state = parseDoorState("S".repeat(43));
    if (state === null) throw new Error("state");
    const encoded = clientFor().signTicket({
      user: USER,
      did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Parameters<ReturnType<typeof clientFor>["signTicket"]>[0]["did"],
      sid: sessionRef(Buffer.alloc(32, 1)),
      state,
    });
    // What the door does with the fragment: decode it and post the envelope to chat-admin with the browser's device.
    const ticket = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const first = await service.post("/v1/session.mint", { ticket, device: null });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      token: expect.any(String),
      device: expect.stringMatching(/^[A-Z0-9]{10}$/),
    });
    const again = await service.post("/v1/session.mint", { ticket, device: null });
    expect(again.status).toBe(403);
    expect(service.logs.at(-1)).toMatchObject({ outcome: "denied", reason: "replay" });
  });

  test("chat.client_sweep_accepted: chat-admin takes web's sweep and deletes only the idle plain room", async () => {
    const synapse = await fakeSynapse(mas);
    await service.close();
    service = await startService(mas, { synapse: createSynapse({ adminUrl: synapse.url }) });
    const old = Date.now() - 31 * DAY_MS;
    synapse.rooms.set("!plain", { encryption: null, state: PLAIN_STATE, newest: old });
    synapse.rooms.set("!enc", { encryption: "m.megolm.v1.aes-sha2", state: ENCRYPTED_STATE, newest: old });
    expect(await clientFor().sweepRooms()).toEqual({ kind: "swept", deleted: 1, kept: 1, failed: 0 });
    expect([...synapse.rooms.keys()]).toEqual(["!enc"]);
    await synapse.close();
  });
});
