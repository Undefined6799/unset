// The chat account follows the Unset account (ADR 0084): an erased member's chat account is deactivated, and erased,
// by a queued job that retries until chat-admin has done it. The ports are doubles of Postgres and chat-admin.
import { describe, expect, test } from "vitest";
import type { ChatUser } from "./chat-account.ts";
import {
  type ChatAccountChange,
  type ChatErasureJob,
  type ChatErasurePorts,
  ERASE_STUCK_ATTEMPTS,
  eraseDueAccounts,
} from "./chat-lifecycle.ts";

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
const job = (c: string, attempts = 0): ChatErasureJob => ({ user: user(c), attempts, lease: `lease-${c}` });

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
