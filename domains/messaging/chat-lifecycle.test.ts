// The chat account follows the Unset account (ADR 0096): an erased member's chat account is deactivated, and erased,
// by a queued job that retries until chat-admin has done it; a suspended one is locked, and unlocked when active again. The ports are doubles of Postgres and chat-admin.
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import type { ChatUser } from "./chat-account.ts";
import {
  type ChatAccountChange,
  type ChatErasureJob,
  type ChatErasurePorts,
  type ChatLockJob,
  type ChatLockPorts,
  type ChatSessionEndJob,
  type ChatSessionEndPorts,
  CREATE_LANDS_WITHIN_S,
  END_STUCK_ATTEMPTS,
  ERASE_STUCK_ATTEMPTS,
  endDueSessions,
  eraseDueAccounts,
  followAccountStates,
} from "./chat-lifecycle.ts";
import type { DeviceId, EndOutcome } from "./index.ts";

const user = (c: string) => `u${c.repeat(20)}` as ChatUser;

function ports(answers: ChatAccountChange[], jobs: ChatErasureJob[]) {
  const calls: string[] = [];
  const queue = [...jobs];
  const double: ChatErasurePorts = {
    claim: async () => queue.shift() ?? null,
    deactivate: async (u) => {
      calls.push(`deactivate ${u}`);
      return answers.shift() ?? { kind: "unavailable" };
    },
    finish: async (job) => {
      calls.push(`finish ${job.user}`);
      return true;
    },
    retry: async (job, inS) => {
      calls.push(`retry ${job.user} ${inS}`);
      return true;
    },
  };
  return { double, calls };
}
const job = (c: string, attempts = 0, queuedForS = CREATE_LANDS_WITHIN_S): ChatErasureJob => ({
  user: user(c),
  attempts,
  lease: `lease-${c}`,
  queuedForS,
});

describe("eraseDueAccounts", () => {
  test("chat.erase_deactivates_then_finishes: the queued row goes only once chat-admin has deactivated", async () => {
    const { double, calls } = ports([{ kind: "done" }], [job("a")]);
    expect(await eraseDueAccounts(double, 10)).toEqual({ erased: 1, retry: 0, lost: 0, stuck: 0 });
    expect(calls).toEqual([`deactivate ${user("a")}`, `finish ${user("a")}`]);
  });

  test("chat.erase_never_made: an account chat-admin never made is already gone, and the row goes", async () => {
    const { double, calls } = ports([{ kind: "no_account" }], [job("b")]);
    expect((await eraseDueAccounts(double, 10)).erased).toBe(1);
    expect(calls.at(-1)).toBe(`finish ${user("b")}`);
  });

  test("chat.erase_waits_for_late_create: an account missing right after erasure is asked again later", async () => {
    // A creation claimed before the erasure may still reach MAS; until it can no longer land, "no account" is not
    // the end, or the account would be created afterwards with the erased member's handle.
    const { double, calls } = ports(
      [{ kind: "no_account" }, { kind: "no_account" }],
      [job("y", 0, CREATE_LANDS_WITHIN_S - 1), job("z", 1, CREATE_LANDS_WITHIN_S)],
    );
    expect(await eraseDueAccounts(double, 10)).toEqual({ erased: 1, retry: 1, lost: 0, stuck: 0 });
    expect(calls).toEqual([
      `deactivate ${user("y")}`,
      `retry ${user("y")} 30`,
      `deactivate ${user("z")}`,
      `finish ${user("z")}`,
    ]);
  });

  test("chat.erase_retries: unavailable or refused keeps the row and waits; it never gives up", async () => {
    const { double, calls } = ports(
      [{ kind: "unavailable" }, { kind: "rejected" }],
      [job("c"), job("d", ERASE_STUCK_ATTEMPTS)],
    );
    expect(await eraseDueAccounts(double, 10)).toEqual({ erased: 0, retry: 2, lost: 0, stuck: 1 });
    expect(calls).toEqual([
      `deactivate ${user("c")}`,
      `retry ${user("c")} 30`,
      `deactivate ${user("d")}`,
      `retry ${user("d")} 3600`,
    ]);
  });

  test("chat.erase_limit: at most `limit` jobs per run", async () => {
    const { double, calls } = ports([{ kind: "done" }, { kind: "done" }], [job("e"), job("f")]);
    expect((await eraseDueAccounts(double, 1)).erased).toBe(1);
    expect(calls).toHaveLength(2);
  });
});

function lockPorts(answers: ChatAccountChange[], jobs: ChatLockJob[]) {
  const calls: string[] = [];
  const queue = [...jobs];
  const double: ChatLockPorts = {
    claim: async () => queue.shift() ?? null,
    change: async (u, lock) => {
      calls.push(`${lock ? "lock" : "unlock"} ${u}`);
      return answers.shift() ?? { kind: "unavailable" };
    },
    settle: async (job) => {
      calls.push(`settle ${job.user} ${job.lock}`);
      return true;
    },
    retry: async (job, inS) => {
      calls.push(`retry ${job.user} ${inS}`);
      return true;
    },
  };
  return { double, calls };
}
const lockJob = (c: string, lock: boolean, attempts = 0): ChatLockJob => ({
  did: `did:plc:${c.repeat(24)}` as Did,
  user: user(c),
  lock,
  attempts,
  lease: `lease-${c}`,
});

describe("followAccountStates", () => {
  test("chat.lock_follows: a suspended member's account is locked, an active one unlocked, each recorded once done", async () => {
    const { double, calls } = lockPorts(
      [{ kind: "done" }, { kind: "done" }],
      [lockJob("g", true), lockJob("h", false)],
    );
    expect(await followAccountStates(double, 10)).toEqual({ changed: 2, retry: 0, lost: 0 });
    expect(calls).toEqual([
      `lock ${user("g")}`,
      `settle ${user("g")} true`,
      `unlock ${user("h")}`,
      `settle ${user("h")} false`,
    ]);
  });

  test("chat.lock_retries: no answer, a refusal or an account chat-admin lacks is tried again later", async () => {
    const { double, calls } = lockPorts(
      [{ kind: "unavailable" }, { kind: "rejected" }, { kind: "no_account" }],
      [lockJob("i", true), lockJob("j", true, 1), lockJob("k", false, 3)],
    );
    expect(await followAccountStates(double, 10)).toEqual({ changed: 0, retry: 3, lost: 0 });
    expect(calls.filter((c) => c.startsWith("retry"))).toEqual([
      `retry ${user("i")} 30`,
      `retry ${user("j")} 120`,
      `retry ${user("k")} 3600`,
    ]);
  });
});

const device = (c: string) => c.toUpperCase().repeat(10) as DeviceId;
function endPorts(answers: EndOutcome[], jobs: ChatSessionEndJob[]) {
  const calls: string[] = [];
  const queue = [...jobs];
  const double: ChatSessionEndPorts = {
    claim: async () => queue.shift() ?? null,
    end: async (u, d) => {
      calls.push(`end ${u} ${d}`);
      return answers.shift() ?? { kind: "unavailable" };
    },
    finish: async (j) => {
      calls.push(`finish ${j.device}`);
      return true;
    },
    retry: async (j, inS) => {
      calls.push(`retry ${j.device} ${inS}`);
      return true;
    },
  };
  return { double, calls };
}
const endJob = (c: string, attempts = 0): ChatSessionEndJob => ({
  user: user(c),
  device: device(c),
  attempts,
  lease: `lease-${c}`,
});

describe("endDueSessions", () => {
  test("chat.end_then_finish: a queued device is ended by chat-admin, and only then finished", async () => {
    const { double, calls } = endPorts([{ kind: "ended" }], [endJob("a")]);
    expect(await endDueSessions(double, 10)).toEqual({ ended: 1, retry: 0, lost: 0, stuck: 0 });
    expect(calls).toEqual([`end ${user("a")} ${device("a")}`, `finish ${device("a")}`]);
  });

  test("chat.end_retries: no answer keeps the device queued with a wait, and it never gives up", async () => {
    const { double, calls } = endPorts([], [endJob("b"), endJob("c", END_STUCK_ATTEMPTS)]);
    expect(await endDueSessions(double, 10)).toEqual({ ended: 0, retry: 2, lost: 0, stuck: 1 });
    expect(calls.filter((c) => c.startsWith("retry"))).toEqual([
      `retry ${device("b")} 30`,
      `retry ${device("c")} 3600`,
    ]);
  });

  test("chat.end_limit_and_lost: at most `limit` per run, and a lost lease is counted", async () => {
    const { double } = endPorts([{ kind: "ended" }, { kind: "ended" }], [endJob("d"), endJob("e")]);
    const lost = { ...double, finish: async () => false };
    expect(await endDueSessions(lost, 1)).toEqual({ ended: 0, retry: 0, lost: 1, stuck: 0 });
  });
});
