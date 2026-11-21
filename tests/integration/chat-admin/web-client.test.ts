// web's chat-admin client against chat-admin itself (build step 5; ADR 0081 decision 5): the envelope web signs passes
// every check chat-admin makes, through a real net-guard on loopback. MAS is the fake from harness.ts (an unmanaged
// dependency, TE-1).
import type { Handle } from "@unset/domains-identity";
import type { ChatUser } from "@unset/domains-messaging";
import { createChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
});
