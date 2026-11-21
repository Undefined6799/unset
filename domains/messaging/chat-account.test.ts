// The chat account rules (ADR 0010, ADR 0081 decision 3): an opaque chat user per member, and the queued creation's
// outcomes. The ports are doubles of Postgres and chat-admin, so the rule is read without either.
import type { Did, Handle } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import {
  CHAT_USER,
  type ChatAccountCreation,
  type ChatAccountJob,
  type ChatAccountPorts,
  type ChatUser,
  createDueAccounts,
  type JobSettlement,
  MAX_ATTEMPTS,
  newChatUser,
  parseChatUser,
  retryDelayS,
} from "./chat-account.ts";

const ALICE = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const HANDLE = "a.unset.name" as Handle;

describe("newChatUser", () => {
  test("chat.user_from_random_only: the same random bytes give the same user, whoever the member is", () => {
    // 13 bytes of 0x00 then base32 lower case: every 5-bit group is 0, so "a" twenty times after the "u".
    const zeros = (n: number) => new Uint8Array(n);
    expect(newChatUser(zeros)).toBe(`u${"a".repeat(20)}`);
    const ff = (n: number) => new Uint8Array(n).fill(0xff);
    expect(newChatUser(ff)).toBe(`u${"7".repeat(20)}`);
    // The generator takes no DID or handle at all (ADR 0010): its only input is the random source.
    expect(newChatUser.length).toBe(1);
  });

  test("chat.user_valid_and_random: 1,000 real draws fit MAS and chat-admin and never repeat", async () => {
    const { randomBytes } = await import("node:crypto");
    const users = Array.from({ length: 1000 }, () => newChatUser((n) => randomBytes(n)));
    for (const user of users) {
      expect(user).toMatch(CHAT_USER);
      // MAS 1.26.0 add.rs username_valid: a-z 0-9 = _ - . / +, not starting with _, at most 255 bytes.
      expect(user).toMatch(/^[a-z0-9=_\-./+]{1,255}$/);
      // chat-admin's envelope USER rule.
      expect(user).toMatch(/^[a-z0-9]{12,64}$/);
    }
    expect(new Set(users).size).toBe(users.length);
  });

  test("chat.user_parse: only the generator's form parses", () => {
    expect(parseChatUser(`u${"b".repeat(20)}`)).toBe(`u${"b".repeat(20)}`);
    for (const bad of [
      `u${"b".repeat(19)}`,
      `x${"b".repeat(20)}`,
      `u${"B".repeat(20)}`,
      `u${"1".repeat(20)}`,
      7,
      null,
    ]) {
      expect(parseChatUser(bad)).toBeNull();
    }
  });
});

describe("retryDelayS", () => {
  test("chat.backoff: 30 s, 2 min, 10 min, then hourly", () => {
    expect([1, 2, 3, 4, 5, 20].map(retryDelayS)).toEqual([30, 120, 600, 3600, 3600, 3600]);
  });
});

/** Ports over one claimed job: what each was asked, and what they answer. */
function ports(answers: { handle?: Handle | null; create?: ChatAccountCreation | Error; attempts?: number }) {
  const job: ChatAccountJob = {
    did: ALICE,
    user: `u${"c".repeat(20)}` as ChatUser,
    attempts: answers.attempts ?? 0,
    lease: "lease-1",
  };
  const created: { user: ChatUser; name: Handle }[] = [];
  const settled: JobSettlement[] = [];
  let claims = 0;
  const doubles: ChatAccountPorts = {
    claim: async () => {
      claims += 1;
      return claims === 1 ? job : null;
    },
    verifiedHandle: async () => (answers.handle === undefined ? HANDLE : answers.handle),
    create: async (user, name) => {
      created.push({ user, name });
      const answer = answers.create ?? { kind: "created" };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    settle: async (_job, settlement) => {
      settled.push(settlement);
      return true;
    },
  };
  return { doubles, created, settled };
}

describe("createDueAccounts", () => {
  test("chat.create_ready: the stored user is created with the verified handle as its name, then ready", async () => {
    const { doubles, created, settled } = ports({});
    expect(await createDueAccounts(doubles, 20)).toEqual({ ready: 1, retry: 0, failed: 0, lost: 0 });
    expect(created).toEqual([{ user: `u${"c".repeat(20)}`, name: HANDLE }]);
    expect(settled).toEqual([{ state: "ready" }]);
  });

  test("chat.create_unverified_waits: with no verified handle nothing is created and the job waits", async () => {
    const { doubles, created, settled } = ports({ handle: null });
    expect(await createDueAccounts(doubles, 20)).toMatchObject({ retry: 1 });
    expect(created).toEqual([]);
    expect(settled).toEqual([{ state: "pending", retryInS: 30 }]);
  });

  test.each([
    ["unavailable", { kind: "unavailable" }, { state: "pending", retryInS: 30 }],
    ["taken", { kind: "taken" }, { state: "failed" }],
    ["rejected", { kind: "rejected" }, { state: "failed" }],
  ] as const)("chat.create_%s", async (_name, answer, settlement) => {
    const { doubles, settled } = ports({ create: answer });
    await createDueAccounts(doubles, 20);
    expect(settled).toEqual([settlement]);
  });

  test("chat.create_backoff_then_failed: retries grow, and the last allowed attempt fails the job", async () => {
    const third = ports({ create: { kind: "unavailable" }, attempts: 2 });
    await createDueAccounts(third.doubles, 20);
    expect(third.settled).toEqual([{ state: "pending", retryInS: 600 }]);
    const last = ports({ create: { kind: "unavailable" }, attempts: MAX_ATTEMPTS - 1 });
    expect(await createDueAccounts(last.doubles, 20)).toMatchObject({ failed: 1 });
    expect(last.settled).toEqual([{ state: "failed" }]);
  });

  test("chat.create_one_claim_at_a_time: the runner claims again after each job, up to its limit", async () => {
    const claimed: number[] = [];
    let left = 3;
    const { doubles } = ports({});
    const many: ChatAccountPorts = {
      ...doubles,
      claim: async () => {
        claimed.push(left);
        left -= 1;
        return left >= 0
          ? { did: ALICE, user: `u${"c".repeat(20)}` as ChatUser, attempts: 0, lease: `l${left}` }
          : null;
      },
    };
    expect(await createDueAccounts(many, 2)).toMatchObject({ ready: 2 });
    expect(claimed).toEqual([3, 2]);
    left = 1;
    expect(await createDueAccounts(many, 20)).toMatchObject({ ready: 1 });
  });

  test("chat.create_lost_lease: a settle that finds the lease gone is counted, not retried", async () => {
    const { doubles } = ports({});
    const lost = { ...doubles, settle: async () => false };
    expect(await createDueAccounts(lost, 20)).toEqual({ ready: 0, retry: 0, failed: 0, lost: 1 });
  });

  test("chat.create_throw_stands: an unexpected error is not swallowed", async () => {
    const { doubles, settled } = ports({ create: new TypeError("bug") });
    await expect(createDueAccounts(doubles, 20)).rejects.toThrow(TypeError);
    expect(settled).toEqual([]);
  });
});
