// Ported from interfaces/http/email-refresh.test.ts (P1.20f; the Hono copy goes at P1.20k), plus the two outcomes
// verify-email adds (`onHold`, `hold`).
// P2.11a (email-refresh.ts): what the gate hears back from the PDS when the cached confirmation is stale. A dead grant
// is "ended", never "unconfirmed": by then pds-call.ts `authDead` has ended every session of the DID.
import { parseDid } from "@unset/domains-identity";
import type { PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { Session } from "@unset/infrastructure-session";
import { expect, test } from "vitest";
import { type EmailRefreshDeps, emailRefresher, PDS_HOLD_MAX_MEMBERS, PDS_HOLD_MS } from "./email-refresh.ts";

/** The gate's view: the refresh alone, as the Hono copy returned it. */
const emailRefresh = (deps: EmailRefreshDeps) => emailRefresher(deps).refresh;

const did = parseDid(`did:plc:${"a".repeat(24)}`);
if (did === null) throw new Error("test DID did not parse");
const SESSION: Session = {
  did,
  idHash: Buffer.alloc(32, 1),
  createdAt: new Date(0),
  emailConfirmed: true,
};

function refreshWith(info: PdsResult<SessionInfo>) {
  const writes: boolean[] = [];
  const refresh = emailRefresh({
    sessionInfo: async () => info,
    setEmailConfirmed: async (_idHash, value) => {
      writes.push(value);
    },
    now: () => 0,
  });
  return { answer: () => refresh(SESSION, AbortSignal.timeout(1000), performance.now() + 1000), writes };
}

test("email_refresh.auth_dead_is_ended", async () => {
  const { answer, writes } = refreshWith({ kind: "auth_dead" });
  expect(await answer()).toBe("ended");
  expect(writes).toEqual([]);
});

test("email_refresh.scope_missing_and_rejected_stay_unconfirmed", async () => {
  for (const info of [
    { kind: "scope_missing" },
    { kind: "rejected", xrpcError: "InvalidRequest", status: 400 },
  ] as const) {
    const { answer, writes } = refreshWith(info);
    expect(await answer(), info.kind).toBe("unconfirmed");
    expect(writes).toEqual([]);
  }
});

test("email_refresh.transient_keeps_the_cache", async () => {
  const { answer, writes } = refreshWith({ kind: "transient", code: "pds_unavailable" });
  expect(await answer()).toBe("transient");
  expect(writes).toEqual([]);
});

test("email_refresh.ok_caches_the_answer", async () => {
  const { answer, writes } = refreshWith({ kind: "ok", value: { handle: "alice.test", emailConfirmed: false } });
  expect(await answer()).toBe("unconfirmed");
  expect(writes).toEqual([false]);
});

test("email_refresh.passes_the_route_deadline_to_the_pds_read", async () => {
  // P2.07a: the PDS read retries only while it fits before the route's own deadlineAt, so it must arrive unchanged.
  const seen: number[] = [];
  const refresh = emailRefresh({
    sessionInfo: async (_did, _deadline, deadlineAt) => {
      seen.push(deadlineAt);
      return { kind: "transient", code: "pds_unavailable" };
    },
    setEmailConfirmed: async () => undefined,
    now: () => 0,
  });
  await refresh(SESSION, AbortSignal.timeout(1000), 12_345);
  expect(seen).toEqual([12_345]);
});

// P2.11g: after the PDS fails to answer, the gate stops asking for that member for a short hold.
function refreshAnswering(answers: PdsResult<SessionInfo>[]) {
  let now = 0;
  let asked = 0;
  const refresh = emailRefresh({
    sessionInfo: async () => {
      asked += 1;
      return answers.shift() ?? { kind: "transient", code: "pds_unavailable" };
    },
    setEmailConfirmed: async () => undefined,
    now: () => now,
  });
  return {
    view: (session: Session = SESSION) => refresh(session, AbortSignal.timeout(1000), 1000),
    advance: (ms: number) => {
      now += ms;
    },
    asked: () => asked,
  };
}

test("email_refresh.transient_holds_the_next_asks", async () => {
  for (const code of ["pds_unavailable", "pds_rate_limited"] as const) {
    const gate = refreshAnswering([{ kind: "transient", code }]);
    expect(await gate.view()).toBe("transient");
    gate.advance(PDS_HOLD_MS - 1);
    expect(await gate.view(), code).toBe("transient");
    expect(gate.asked(), code).toBe(1);
  }
});

test("email_refresh.hold_ends_and_the_pds_is_asked_again", async () => {
  const gate = refreshAnswering([
    { kind: "transient", code: "pds_unavailable" },
    { kind: "ok", value: { handle: "alice.test", emailConfirmed: true } },
  ]);
  await gate.view();
  gate.advance(PDS_HOLD_MS);
  expect(await gate.view()).toBe("confirmed");
  expect(gate.asked()).toBe(2);
  // A good answer leaves no hold behind.
  expect(await gate.view()).toBe("transient");
  expect(gate.asked()).toBe(3);
});

test("email_refresh.hold_is_per_member", async () => {
  const other = parseDid(`did:plc:${"b".repeat(24)}`);
  if (other === null) throw new Error("test DID did not parse");
  const gate = refreshAnswering([{ kind: "transient", code: "pds_unavailable" }, { kind: "auth_dead" }]);
  await gate.view();
  expect(await gate.view({ ...SESSION, did: other })).toBe("ended");
  expect(gate.asked()).toBe(2);
});

test("email_refresh.lock_timeout_and_final_answers_hold_nothing", async () => {
  for (const first of [
    { kind: "transient", code: "lock_timeout" },
    { kind: "auth_dead" },
    { kind: "scope_missing" },
    { kind: "ok", value: { handle: "alice.test", emailConfirmed: false } },
  ] as const) {
    const gate = refreshAnswering([first]);
    await gate.view();
    await gate.view();
    expect(gate.asked(), first.kind).toBe(2);
  }
});

test("email_refresh.full_hold_table_starts_over", async () => {
  const gate = refreshAnswering([]);
  const member = (n: number): Session => {
    const letters = [...n.toString(26)].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 26)));
    const parsed = parseDid(`did:plc:${letters.join("").padStart(24, "a")}`);
    if (parsed === null) throw new Error("test DID did not parse");
    return { ...SESSION, did: parsed };
  };
  for (let n = 0; n <= PDS_HOLD_MAX_MEMBERS; n++) await gate.view(member(n));
  const asked = gate.asked();
  // The table was emptied to admit the last member, so the first member is asked again: never a stuck hold.
  await gate.view(member(0));
  expect(gate.asked()).toBe(asked + 1);
  // The last member's hold stands.
  await gate.view(member(PDS_HOLD_MAX_MEMBERS));
  expect(gate.asked()).toBe(asked + 1);
});

// P1.20f: verify-email reads the same hold (`onHold`) and starts it after its own fresh read (`hold`).
test("email_refresh.verify_email_sees_and_starts_the_same_hold", async () => {
  let now = 0;
  let asked = 0;
  const refresher = emailRefresher({
    sessionInfo: async () => {
      asked += 1;
      return { kind: "ok", value: { handle: "alice.test", emailConfirmed: true } };
    },
    setEmailConfirmed: async () => undefined,
    now: () => now,
  });
  expect(refresher.onHold(did)).toBe(false);
  refresher.hold(did, { kind: "transient", code: "pds_unavailable" });
  expect(refresher.onHold(did)).toBe(true);
  // The gate hears "transient" without asking while verify-email's hold stands.
  expect(await refresher.refresh(SESSION, AbortSignal.timeout(1000), 1000)).toBe("transient");
  expect(asked).toBe(0);
  now += PDS_HOLD_MS;
  expect(refresher.onHold(did)).toBe(false);
});

test("email_refresh.verify_email_holds_only_a_pds_that_did_not_answer", () => {
  const refresher = emailRefresher({
    sessionInfo: async () => ({ kind: "auth_dead" }),
    setEmailConfirmed: async () => undefined,
    now: () => 0,
  });
  for (const info of [
    { kind: "transient", code: "lock_timeout" },
    { kind: "auth_dead" },
    { kind: "scope_missing" },
    { kind: "ok", value: { handle: "alice.test", emailConfirmed: true } },
  ] as const) {
    refresher.hold(did, info);
    expect(refresher.onHold(did), info.kind).toBe(false);
  }
});
