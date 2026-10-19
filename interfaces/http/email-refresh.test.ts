// P2.11a (email-refresh.ts): what the gate hears back from the PDS when the cached confirmation is stale. A dead grant
// is "ended", never "unconfirmed": by then pds-call.ts `authDead` has ended every session of the DID.
import { parseDid } from "@unset/domains-identity";
import type { PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { Session } from "@unset/infrastructure-session";
import { expect, test } from "vitest";
import { emailRefresh } from "./email-refresh.ts";

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
  });
  return { answer: () => refresh(SESSION, AbortSignal.timeout(1000)), writes };
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
