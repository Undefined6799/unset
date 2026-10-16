// P2.07 (pds-call.ts): restore, classify, retry. The OAuth client and the session end are fakes; the XRPC client is
// the real @atproto/api 0.24.2 Agent over a fake fetchHandler, except where the test throws before any XRPC.
import { TokenRefreshError } from "@atproto/oauth-client-node";
import type { Did } from "@unset/domains-identity";
import type { LogEvent, Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { createPdsCall, type PdsContext, respondToPdsFailure } from "./pds-call.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;

function harness(
  world: {
    restore?: () => Promise<{ fetchHandler(url: string, init?: RequestInit): Promise<Response> }>;
    token?: boolean;
    fetch?: (url: string) => Promise<Response>;
  } = {},
) {
  const ended: Did[] = [];
  const lines: LogEvent[] = [];
  const log: Logger = {
    info: (event) => lines.push(event),
    warn: (event) => lines.push(event),
    error: (event) => lines.push(event),
    logError: () => undefined,
  };
  let fetches = 0;
  const api = createPdsCall({
    client: {
      restore: async () =>
        world.restore === undefined
          ? {
              async fetchHandler(url: string) {
                fetches += 1;
                return world.fetch === undefined ? Response.json({ ok: true }) : world.fetch(url);
              },
            }
          : world.restore(),
    },
    endSessions: async (did) => {
      ended.push(did);
    },
    tokenSetRemains: async () => world.token !== false,
    log,
  });
  const ctx = (deadlineAt: number, deadline: AbortSignal = new AbortController().signal): PdsContext => ({
    memo: new Map(),
    deadline,
    deadlineAt,
  });
  return { ...api, ended, lines, fetches: () => fetches, ctx };
}

const far = () => Date.now() + 60_000;
const httpError = (status: number, name = "XRPCError") => Object.assign(new Error(name), { status, name });

describe("pdsCall", () => {
  test("pdsCall.retry_respects_deadline", async () => {
    let calls = 0;
    const { pdsCall, ctx } = harness();
    const result = await pdsCall(
      ctx(Date.now() + 50),
      DID,
      async () => {
        calls += 1;
        throw httpError(503);
      },
      { idempotent: true, timeoutMs: 10_000 },
    );
    expect(result).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(calls).toBe(1);
  });

  test("pdsCall.handshake_retry_once", async () => {
    let calls = 0;
    const { pdsCall, ended, ctx } = harness();
    const once = await pdsCall(
      ctx(far()),
      DID,
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("nonce"), { status: 401, error: "use_dpop_nonce" });
        return "ok";
      },
      { idempotent: true },
    );
    expect(once).toEqual({ kind: "ok", value: "ok" });
    calls = 0;
    const twice = await pdsCall(
      ctx(far()),
      DID,
      async () => {
        calls += 1;
        throw Object.assign(new Error("nonce"), { status: 401, error: "use_dpop_nonce" });
      },
      { idempotent: true },
    );
    expect(twice).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(calls).toBe(2);
    expect(ended).toEqual([]);
  });

  test("pdsCall.5xx_idempotent_retry", async () => {
    let calls = 0;
    const { pdsCall, ctx } = harness();
    const retried = await pdsCall(
      ctx(far()),
      DID,
      async () => {
        calls += 1;
        if (calls === 1) throw httpError(503);
        return "ok";
      },
      { idempotent: true, timeoutMs: 1000 },
    );
    expect(retried).toEqual({ kind: "ok", value: "ok" });
    expect(calls).toBe(2);
    calls = 0;
    const once = await pdsCall(
      ctx(far()),
      DID,
      async () => {
        calls += 1;
        throw httpError(503);
      },
      { idempotent: false },
    );
    expect(once).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(calls).toBe(1);
  });

  test("pdsCall.401_auth_dead", async () => {
    const { pdsCall, ended, ctx } = harness({ token: false });
    const cleared = { value: false };
    const context = ctx(far());
    context.clearSession = () => {
      cleared.value = true;
    };
    const result = await pdsCall(
      context,
      DID,
      async () => {
        throw httpError(401, "InvalidToken");
      },
      { idempotent: true },
    );
    expect(result).toEqual({ kind: "auth_dead" });
    expect(ended).toEqual([DID]);
    expect(cleared.value).toBe(true);
  });

  test("pdsCall.401_refresh_throws_is_transient", async () => {
    const { pdsCall, ended, lines, ctx } = harness({ token: true });
    const result = await pdsCall(
      ctx(far()),
      DID,
      async () => {
        throw httpError(401, "InvalidToken");
      },
      { idempotent: true },
    );
    expect(result).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(ended).toEqual([]);
    expect(lines).toContain("pds.401_with_live_set");
  });

  test("pdsCall.issuer_mismatch_auth_dead", async () => {
    const { pdsCall, ended } = harness({
      restore: async () => {
        throw new TypeError("Issuer mismatch");
      },
    });
    expect(await pdsCall(null, DID, async () => "no", { idempotent: true })).toEqual({ kind: "auth_dead" });
    expect(ended).toEqual([DID]);
  });

  test("pdsCall.auth_method_unsatisfiable_auth_dead", async () => {
    const { pdsCall, ended } = harness({
      restore: async () => {
        const error = new Error("key gone");
        error.name = "AuthMethodUnsatisfiableError";
        throw error;
      },
    });
    expect(await pdsCall(null, DID, async () => "no", { idempotent: true })).toEqual({ kind: "auth_dead" });
    expect(ended).toEqual([DID]);
  });

  test("pdsCall.refresh_revoked", async () => {
    const { pdsCall, ended } = harness({
      restore: async () => {
        throw new TokenRefreshError(DID, "The session was revoked");
      },
    });
    expect(await pdsCall(null, DID, async () => "no", { idempotent: true })).toEqual({ kind: "auth_dead" });
    expect(ended).toEqual([DID]);
  });

  test("pdsCall.lock_timeout", async () => {
    const { pdsCall, ended } = harness({
      restore: async () => {
        const error = new Error("lock");
        error.name = "LockError";
        Object.assign(error, { code: "lock.timeout" });
        throw error;
      },
    });
    expect(await pdsCall(null, DID, async () => "no", { idempotent: true })).toEqual({
      kind: "transient",
      code: "lock_timeout",
    });
    expect(ended).toEqual([]);
  });

  test("pdsCall.429", async () => {
    let calls = 0;
    const { pdsCall } = harness();
    const result = await pdsCall(
      null,
      DID,
      async () => {
        calls += 1;
        throw httpError(429);
      },
      { idempotent: true },
    );
    expect(result).toEqual({ kind: "transient", code: "pds_rate_limited" });
    expect(calls).toBe(1);
  });

  test("pdsCall.scope_missing", async () => {
    const { pdsCall } = harness();
    const missing = await pdsCall(
      null,
      DID,
      async () => {
        throw Object.assign(new Error("Missing required scope"), {
          name: "ScopeMissingError",
          status: 403,
          scope: "account:email",
        });
      },
      { idempotent: true },
    );
    expect(missing).toEqual({ kind: "scope_missing", scope: "account:email" });
    const wrong = await pdsCall(
      null,
      DID,
      async () => {
        throw Object.assign(new Error("nope"), { name: "ScopeMissing", status: 403 });
      },
      { idempotent: true },
    );
    expect(wrong).toEqual({ kind: "rejected", xrpcError: "ScopeMissing", status: 403 });
  });

  test("pdsCall.timeout", async () => {
    const { pdsCall } = harness();
    const started = Date.now();
    const result = await pdsCall(null, DID, () => new Promise(() => undefined), { idempotent: false, timeoutMs: 40 });
    expect(result).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(Date.now() - started).toBeLessThan(250);
  });

  test("pdsCall.request_deadline", async () => {
    let calls = 0;
    const { pdsCall, ctx } = harness();
    const deadline = AbortSignal.timeout(200);
    const started = Date.now();
    const result = await pdsCall(
      ctx(started + 200, deadline),
      DID,
      () => {
        calls += 1;
        return new Promise(() => undefined);
      },
      { idempotent: true, timeoutMs: 10_000 },
    );
    expect(result).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(Date.now() - started).toBeLessThan(250);
    expect(calls).toBe(1);
  });

  test("pdsCall.never_throws", async () => {
    const { pdsCall, lines } = harness();
    const result = await pdsCall(
      null,
      DID,
      () => {
        throw new TypeError("nope");
      },
      { idempotent: true },
    );
    expect(result).toEqual({ kind: "transient", code: "pds_unavailable" });
    expect(lines).toContain("pds.unexpected");
  });

  test("pdsSessionInfo.memo", async () => {
    let calls = 0;
    const { pdsSessionInfo, ctx } = harness({
      fetch: async () => {
        calls += 1;
        return Response.json({
          handle: "alice.test",
          did: DID,
          email: "a@example.test",
          emailConfirmed: true,
        });
      },
    });
    const context = ctx(far());
    const [a, b, c] = await Promise.all([
      pdsSessionInfo(context, DID),
      pdsSessionInfo(context, DID),
      pdsSessionInfo(context, DID),
    ]);
    expect(a).toEqual({ kind: "ok", value: { handle: "alice.test", email: "a@example.test", emailConfirmed: true } });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(calls).toBe(1);
  });
});

test("respondToPdsFailure maps the book's pages", () => {
  expect(respondToPdsFailure("POST", { kind: "transient", code: "pds_unavailable" }, "pds.test")).toEqual({
    action: "notice",
    status: 503,
    text: "pds.test is not answering; your session is kept",
  });
  expect(respondToPdsFailure("GET", { kind: "transient", code: "pds_rate_limited" }, "pds.test")).toMatchObject({
    status: 200,
  });
  expect(respondToPdsFailure("GET", { kind: "scope_missing" }, "pds.test")).toEqual({
    action: "redirect",
    location: "/verify-email?error=login.scope_insufficient",
  });
  expect(respondToPdsFailure("GET", { kind: "auth_dead" }, "pds.test")).toMatchObject({
    action: "redirect",
    location: "/login?error=login.session_ended",
  });
  expect(
    respondToPdsFailure("POST", { kind: "rejected", xrpcError: "InvalidRequest", status: 400 }, "pds.test"),
  ).toEqual({
    action: "rejected",
    xrpcError: "InvalidRequest",
    status: 400,
  });
});
