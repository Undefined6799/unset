import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DurabilityLost } from "@unset/shared-admin-envelope";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openRequestLog, verifyLog } from "../../../interfaces/pds-admin/log.ts";
import {
  ALICE,
  type FakePds,
  fakePds,
  PASSWORD,
  payloadFor,
  signed,
  startService,
  tempDir,
  webKey,
} from "./harness.ts";

let pds: FakePds;
let service: Awaited<ReturnType<typeof startService>>;
beforeEach(async () => {
  pds = await fakePds();
  service = await startService(pds);
});
afterEach(async () => {
  await service.close();
  await pds.close();
});

const logLines = () => readFileSync(service.logFile, "utf8").trim().split("\n");
const lastLog = () => JSON.parse(logLines().at(-1) as string) as Record<string, unknown>;
const issue = (overrides = {}) => service.post(signed(service.key, payloadFor(overrides)));

describe("issue", () => {
  test("issue.happy_path: returns the code; the PDS saw forAccount and Basic auth; the log holds a MAC only", async () => {
    const res = await issue();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; remaining: number; availableAt: string | null };
    expect(body).toEqual({ code: "pds-example-com-abcde-00001", remaining: 4, availableAt: null });
    const create = pds.seen.find((s) => s.path === "/xrpc/com.atproto.server.createInviteCode");
    expect(JSON.parse(create?.body ?? "{}")).toEqual({ useCount: 1, forAccount: ALICE });
    expect(create?.auth).toBe(`Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`);
    const entry = lastLog();
    expect(entry.outcome).toBe("issued");
    expect(entry.codeMac).toMatch(/^[0-9a-f]{64}$/);
  });

  test("log.no_raw_did: no DID, code or password anywhere in the log", async () => {
    await issue();
    await issue({ target: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", actor_did: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb" });
    await service.post("{");
    const text = readFileSync(service.logFile, "utf8");
    expect(text).not.toContain("did:");
    expect(text).not.toContain("pds-example-com");
    expect(text).not.toContain(PASSWORD);
  });

  test("log.no_unauthenticated_fields: a refused envelope's kid, jti and verb never reach the log", async () => {
    const forged = signed(webKey("other"), payloadFor({ verb: ALICE, jti: "pds-example-com-abcde" }));
    const res = await service.post({ ...forged, kid: "did:plc:smuggledkid" });
    expect(res.status).toBe(403);
    const entry = lastLog();
    expect(entry).toMatchObject({ outcome: "denied", reason: "unknown_kid" });
    expect(entry.kid).toBeUndefined();
    const text = readFileSync(service.logFile, "utf8");
    expect(text).not.toContain("did:");
    expect(text).not.toContain("pds-example-com");
  });

  test.each([
    ["issue.not_found_400", () => (pds.account = "not_found"), "not_hosted"],
    ["issue.taken_down_via_subject_status", () => (pds.takedown = true), "taken_down"],
    [
      "issue.invites_disabled",
      () => (pds.account = { invitesDisabled: true, emailConfirmedAt: "2026-11-01T00:00:00Z" }),
      "invites_disabled",
    ],
    ["issue.email_unconfirmed", () => (pds.account = { invites: [] }), "email_unconfirmed"],
    [
      "issue.deactivated",
      () => (pds.account = { deactivatedAt: "2026-11-02T00:00:00Z", emailConfirmedAt: "x" }),
      "deactivated",
    ],
  ])("%s → 403, no code created", async (_name, arrange, reason) => {
    arrange();
    const res = await issue();
    expect(res.status).toBe(403);
    expect(pds.codes).toBe(0);
    expect(lastLog()).toMatchObject({ outcome: "denied", reason });
  });

  test("issue.signups_closed: 409 and the PDS is not called", async () => {
    await service.close();
    service = await startService(pds, {
      limits: { signupsOpen: false, windowMs: 86_400_000, maxPerWindow: 5, maxPerDayGlobal: 100 },
    });
    const res = await issue();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "signups_closed" });
    expect(pds.seen).toEqual([]);
  });

  test("issue.pds_down: 503 and the jti stays burned", async () => {
    const envelope = signed(service.key, payloadFor());
    await pds.close();
    expect((await service.post(envelope)).status).toBe(503);
    expect(readFileSync(service.jtiFile, "utf8")).toContain(envelope.payload.jti);
    expect((await service.post(envelope)).status).toBe(403);
  });

  test("issue.concurrent_quota: limit 5, four issued, six parallel → one 200 and five 429", async () => {
    const hour = 3_600_000;
    const created = [1, 2, 3, 4].map((h) => ({
      code: `c${h}`,
      createdAt: new Date(Date.now() - h * hour).toISOString(),
    }));
    pds.account = { emailConfirmedAt: "2026-11-01T00:00:00Z", invites: created };
    // The fake PDS lists each new code, as the real one does, so the next request sees it.
    const real = pds.account.invites as unknown[];
    const statuses = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const res = await issue();
        if (res.status === 200) real.push({ code: "new", createdAt: new Date().toISOString() });
        return res.status;
      }),
    );
    expect(statuses.sort()).toEqual([200, 429, 429, 429, 429, 429]);
    expect(pds.codes).toBe(1);
  });

  test("issue.quota_global: the daily cap from the log refuses with availableAt", async () => {
    await service.close();
    service = await startService(pds, {
      limits: { signupsOpen: true, windowMs: 86_400_000, maxPerWindow: 5, maxPerDayGlobal: 1 },
    });
    expect((await issue()).status).toBe(200);
    const res = await issue();
    expect(res.status).toBe(429);
    const body = (await res.json()) as { availableAt: string };
    expect(Date.parse(body.availableAt) % 86_400_000).toBe(0);
  });

  test("issue.reserve_before_create: the daily slot is on disk before the PDS call, and stays spent if it fails", async () => {
    await service.close();
    service = await startService(pds, {
      limits: { signupsOpen: true, windowMs: 86_400_000, maxPerWindow: 5, maxPerDayGlobal: 1 },
    });
    let atCreate: Record<string, unknown> | undefined;
    pds.onCreate = () => {
      atCreate = lastLog();
    };
    pds.createStatus = 500;
    expect((await issue()).status).toBe(503);
    expect(atCreate).toMatchObject({ outcome: "reserved" });
    pds.createStatus = 200;
    expect((await issue()).status).toBe(429);
    expect(pds.codes).toBe(0);
  });
});

describe("queued work", () => {
  /** Holds the first request at createInviteCode until `release`, so the next one waits in the issuing chain. */
  async function holdFirst(now: () => number) {
    let release = () => {
      // Replaced by the promise's resolver below.
    };
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = () => {
      // Replaced by the promise's resolver below.
    };
    const atCreate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    pds.onCreate = () => {
      reached();
      return held;
    };
    await service.close();
    service = await startService(pds, { now });
    const first = issue();
    await atCreate;
    return { first, release };
  }
  const queued = () =>
    vi.waitFor(() => expect(readFileSync(service.jtiFile, "utf8").trim().split("\n")).toHaveLength(2));

  test("issue.queued_expiry: an envelope that expires while queued issues nothing", async () => {
    let skew = 0;
    const { first, release } = await holdFirst(() => Date.now() + skew);
    const second = issue();
    await queued();
    skew = 120_000;
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(403);
    expect(pds.codes).toBe(1);
    expect(lastLog()).toMatchObject({ outcome: "denied", reason: "time" });
  });

  test("issue.queued_client_gone: a caller that hung up while queued gets no code", async () => {
    const { first, release } = await holdFirst(() => Date.now());
    const abort = new AbortController();
    const envelope = signed(service.key, payloadFor());
    const second = fetch(`${service.base}/v1/invite.issue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
      signal: abort.signal,
    }).catch(() => "aborted"); // guard-allow: egress test, local service only
    await queued();
    abort.abort();
    expect(await second).toBe("aborted");
    // The service has seen the hang-up once only the held request's connection is left.
    await vi.waitFor(async () => expect(await service.connections()).toBe(1));
    release();
    expect((await first).status).toBe(200);
    await vi.waitFor(() => expect(lastLog()).toMatchObject({ outcome: "denied", reason: "client_gone" }));
    expect(pds.codes).toBe(1);
  });
});

describe("running work", () => {
  test("issue.running_client_gone: a caller that hangs up during the standing checks gets no code or slot", async () => {
    let release = () => {
      // Replaced by the promise's resolver below.
    };
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = () => {
      // Replaced by the promise's resolver below.
    };
    const atStatus = new Promise<void>((resolve) => {
      reached = resolve;
    });
    pds.onStatus = () => {
      reached();
      return held;
    };
    const abort = new AbortController();
    const call = fetch(`${service.base}/v1/invite.issue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed(service.key, payloadFor())),
      signal: abort.signal,
    }).catch(() => "aborted"); // guard-allow: egress test, local service only
    await atStatus;
    abort.abort();
    expect(await call).toBe("aborted");
    await vi.waitFor(async () => expect(await service.connections()).toBe(0));
    release();
    await vi.waitFor(() => expect(lastLog()).toMatchObject({ outcome: "denied", reason: "client_gone" }));
    expect(logLines().some((line) => line.includes('"reserved"'))).toBe(false);
    expect(pds.codes).toBe(0);
  });
});

describe("durability", () => {
  test("state.durability_lost_stops: a state file in an unknown state stops the service, never 200", async () => {
    await service.close();
    const real = openRequestLog(join(tempDir(), "log.jsonl"), randomBytes(32));
    let stops = 0;
    service = await startService(pds, {
      log: {
        ...real,
        append: (fields, now) => {
          if (fields.outcome === "issued") throw new DurabilityLost("append");
          real.append(fields, now);
        },
      },
      stop: () => {
        stops += 1;
      },
    });
    expect((await issue()).status).toBe(503);
    expect(stops).toBe(1);
  });
});

describe("envelope", () => {
  const other = webKey("web-2");
  test.each([
    ["unknown kid", () => signed(other, payloadFor()), 403, "unknown_kid"],
    ["wrong verb", () => signed(service.key, payloadFor({ verb: "account.delete" })), 403, "verb"],
    [
      "actor is not the target",
      () => signed(service.key, payloadFor({ actor_did: "did:plc:mallory" })),
      403,
      "actor_not_target",
    ],
    [
      "bad signature",
      () => ({ ...signed(service.key, payloadFor()), sig: signed(service.key, payloadFor()).sig }),
      403,
      "signature",
    ],
    ["wrong aud", () => signed(service.key, payloadFor({ aud: "chat-admin" })), 403, "claims"],
    ["wrong env", () => signed(service.key, payloadFor({ env: "prod" })), 403, "claims"],
    ["wrong pds_did", () => signed(service.key, payloadFor({ pds_did: "did:web:other.example.com" })), 403, "claims"],
    ["wrong v", () => signed(service.key, payloadFor({ v: 2 })), 403, "claims"],
    ["lives 61 s", () => signed(service.key, payloadFor({ exp: Math.floor(Date.now() / 1000) + 61 })), 403, "time"],
    ["iat 10 s ahead", () => signed(service.key, payloadFor({ iat: Math.floor(Date.now() / 1000) + 10 })), 403, "time"],
    [
      "expired",
      () =>
        signed(
          service.key,
          payloadFor({ iat: Math.floor(Date.now() / 1000) - 70, exp: Math.floor(Date.now() / 1000) - 10 }),
        ),
      403,
      "time",
    ],
    ["not a DID", () => signed(service.key, payloadFor({ target: "alice", actor_did: "alice" })), 400, "did"],
    [
      "extra key",
      () => ({ ...signed(service.key, payloadFor()), payload: { ...payloadFor(), extra: "x" } }),
      400,
      "shape",
    ],
    ["float", () => ({ ...signed(service.key, payloadFor()), payload: { ...payloadFor(), iat: 1.5 } }), 400, "shape"],
    [
      "nested object",
      () => ({ ...signed(service.key, payloadFor()), payload: { ...payloadFor(), env: { a: 1 } } }),
      400,
      "shape",
    ],
  ])("envelope.rejects: %s", async (_name, make, status, reason) => {
    const res = await service.post(make());
    expect(res.status).toBe(status);
    expect(lastLog()).toMatchObject({ outcome: "denied", reason });
    expect(pds.seen).toEqual([]);
  });

  test("envelope.replay: the same envelope twice → 200 then 403; jti.log holds it once", async () => {
    const envelope = signed(service.key, payloadFor());
    expect((await service.post(envelope)).status).toBe(200);
    expect((await service.post(envelope)).status).toBe(403);
    const lines = readFileSync(service.jtiFile, "utf8")
      .split("\n")
      .filter((l) => l.startsWith(envelope.payload.jti));
    expect(lines).toHaveLength(1);
    expect(lastLog()).toMatchObject({ reason: "replay" });
  });

  test("envelope.concurrent_replay: two parallel posts of one envelope → exactly one 200", async () => {
    const envelope = signed(service.key, payloadFor());
    const statuses = await Promise.all(
      [service.post(envelope), service.post(envelope)].map(async (r) => (await r).status),
    );
    expect(statuses.sort()).toEqual([200, 403]);
  });

  test("limits.body_cap: a 5000-byte body → 400 before parsing", async () => {
    const res = await service.post(JSON.stringify({ pad: "x".repeat(5000) }));
    expect(res.status).toBe(400);
    expect(lastLog()).toMatchObject({ reason: "body_cap" });
  });

  test("a body that is not JSON, or not sent as JSON, is 400", async () => {
    expect((await service.post("{")).status).toBe(400);
    const plain = await service.post(signed(service.key, payloadFor()), undefined, { "content-type": "text/plain" });
    expect(plain.status).toBe(400);
  });
});

describe("routes and log", () => {
  test("routes.only_two: everything but POST /v1/invite.issue and GET /health is 404", async () => {
    expect((await fetch(`${service.base}/v1/invite.issue`)).status).toBe(404);
    expect((await service.post({}, "/v1/anything")).status).toBe(404);
    expect((await fetch(`${service.base}/xrpc/com.atproto.admin.getAccountInfo?did=${ALICE}`)).status).toBe(404);
    expect((await service.post({}, "/v1/invite.issue?x=1")).status).toBe(404);
    const health = await fetch(`${service.base}/health`);
    expect(await health.json()).toEqual({ ok: true, commit: "c".repeat(40) });
    expect(pds.seen).toEqual([]);
  });

  test("log.hash_chain: five entries chain; editing the second breaks it at seq 2", async () => {
    await issue();
    await service.post("{");
    await issue();
    const lines = logLines();
    expect(lines.map((line) => JSON.parse(line).outcome)).toEqual([
      "reserved",
      "issued",
      "denied",
      "reserved",
      "issued",
    ]);
    expect(verifyLog(lines)).toBeNull();
    const second = JSON.parse(lines[1] as string) as Record<string, unknown>;
    lines[1] = JSON.stringify({ ...second, reason: "edited" });
    writeFileSync(service.logFile, `${lines.join("\n")}\n`);
    expect(verifyLog(logLines())).toBe(2);
  });
});
