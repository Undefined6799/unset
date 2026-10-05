// The rate-limit primitive (P1.06) against a fake clock and the book's test table.
import { describe, expect, test } from "vitest";
import { ClientIp } from "../clientIp.ts";
import { definePolicies, type PolicyTable } from "./policy.ts";
import { createRateLimiter } from "./rateLimit.ts";

const perMin = (n: number) => n / 60;
/** The P1.06 values, as P1.06p will set them for `web`, plus a ten-minute window for the idle-gap test. */
const TABLE: PolicyTable = {
  default: [
    { capacity: 60, refillPerSec: perMin(300), scope: "ip" },
    { capacity: 3000, refillPerSec: perMin(3000), scope: "global" },
  ],
  login: [{ capacity: 10, refillPerSec: perMin(10), scope: "ip" }],
  search: [
    { capacity: 60, refillPerSec: perMin(60), scope: "ip" },
    { capacity: 60, refillPerSec: perMin(60), scope: "did" },
  ],
  report10: [{ capacity: 5, refillPerSec: 5 / 600, scope: "ip" }],
  tight: [
    { capacity: 1000, refillPerSec: 1, scope: "ip" },
    { capacity: 3, refillPerSec: 1, scope: "global" },
  ],
};

const ip = (text: string) => ClientIp.parse(text);

function limiter(options: { maxKeys?: number; table?: PolicyTable } = {}) {
  let clock = 0;
  let errors = 0;
  const limits = createRateLimiter(options.table ?? TABLE, {
    maxKeys: options.maxKeys ?? 100_000,
    onError: () => {
      errors += 1;
    },
    now: () => clock,
  });
  return {
    limits,
    advance: (ms: number) => {
      clock += ms;
    },
    errors: () => errors,
  };
}

describe("buckets", () => {
  test("bucket_allows_then_denies", () => {
    const { limits } = limiter();
    for (let i = 0; i < 10; i += 1) expect(limits.consume("login", { ip: ip("9.9.9.9") })).toEqual({ ok: true });
    const denied = limits.consume("login", { ip: ip("9.9.9.9") });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.retryAfterS).toBeGreaterThanOrEqual(1);
    expect(limits.consume("login", { ip: ip("8.8.8.8") })).toEqual({ ok: true });
  });

  test("refill_after_time", () => {
    const { limits, advance } = limiter();
    for (let i = 0; i < 10; i += 1) limits.consume("login", { ip: ip("9.9.9.9") });
    expect(limits.consume("login", { ip: ip("9.9.9.9") }).ok).toBe(false);
    advance(6000);
    expect(limits.consume("login", { ip: ip("9.9.9.9") })).toEqual({ ok: true });
    expect(limits.consume("login", { ip: ip("9.9.9.9") }).ok).toBe(false);
  });

  test("clock_backwards_refills_nothing", () => {
    const { limits, advance } = limiter();
    for (let i = 0; i < 10; i += 1) limits.consume("login", { ip: ip("9.9.9.9") });
    advance(-60_000);
    expect(limits.consume("login", { ip: ip("9.9.9.9") }).ok).toBe(false);
  });

  test("idle_bucket_expires", () => {
    const { limits, advance } = limiter();
    limits.consume("login", { ip: ip("9.9.9.9") });
    expect(limits.keys()).toHaveLength(1);
    advance(61_000);
    limits.sweep();
    expect(limits.keys()).toHaveLength(0);
    for (let i = 0; i < 10; i += 1) expect(limits.consume("login", { ip: ip("9.9.9.9") }).ok).toBe(true);
  });

  test("ten-minute-window-survives-idle-gap", () => {
    const { limits, advance } = limiter();
    for (let i = 0; i < 5; i += 1) expect(limits.consume("report10", { ip: ip("9.9.9.9") }).ok).toBe(true);
    advance(61_000);
    limits.sweep();
    expect(limits.keys()).toHaveLength(1);
    expect(limits.consume("report10", { ip: ip("9.9.9.9") }).ok).toBe(false);
    advance(600_000 - 61_000);
    expect(limits.consume("report10", { ip: ip("9.9.9.9") }).ok).toBe(true);
  });

  test("unknown_ip_shared_strict_bucket", () => {
    const { limits } = limiter();
    expect(limits.consume("login", { ip: null }).ok).toBe(true);
    expect(limits.consume("login", { ip: null }).ok).toBe(false);
    expect(limits.consume("login", { ip: ip("9.9.9.9") }).ok).toBe(true);
  });

  test("did_and_ip_both_apply", () => {
    const { limits } = limiter();
    for (let i = 0; i < 60; i += 1) limits.consume("search", { did: "did:plc:alice" });
    expect(limits.consume("search", { ip: ip("9.9.9.9") }).ok).toBe(true);
    expect(limits.consume("search", { did: "did:plc:alice" }).ok).toBe(false);
    expect(limits.consume("search", { did: "did:plc:bob" }).ok).toBe(true);
  });

  test("global_ceiling", () => {
    const { limits } = limiter();
    for (let i = 1; i <= 3; i += 1) expect(limits.consume("tight", { ip: ip(`9.9.9.${i}`) }).ok).toBe(true);
    expect(limits.consume("tight", { ip: ip("9.9.9.4") }).ok).toBe(false);
  });
});

describe("memory and privacy", () => {
  test("keys_not_reversible", () => {
    const { limits, advance } = limiter();
    limits.consume("login", { ip: ip("198.51.100.7") });
    limits.consume("search", { did: "did:plc:alice" });
    const forms = [
      "198.51.100.7",
      "c6336407", // the address as hex
      Buffer.from("198.51.100.7").toString("base64url"),
      Buffer.from([198, 51, 100, 7]).toString("base64url"),
      "did:plc:alice",
      "alice",
    ];
    const before = limits.keys();
    for (const key of before) for (const form of forms) expect(key).not.toContain(form);
    advance(24 * 60 * 60 * 1000);
    limits.sweep();
    limits.consume("login", { ip: ip("198.51.100.7") });
    expect(limits.keys()).toHaveLength(1);
    expect(before).not.toContain(limits.keys()[0]);
  });

  test("key_cap_overflow", () => {
    const { limits } = limiter({ maxKeys: 10 });
    for (let i = 1; i <= 10; i += 1) expect(limits.consume("login", { ip: ip(`9.9.9.${i}`) }).ok).toBe(true);
    expect(limits.consume("login", { ip: ip("9.9.9.11") }).ok).toBe(true);
    expect(limits.consume("login", { ip: ip("9.9.9.12") }).ok).toBe(false);
    expect(limits.keys()).toHaveLength(10);
    expect(limits.consume("login", { ip: ip("9.9.9.1") }).ok).toBe(true);
  });

  test("exception_denies", () => {
    let calls = 0;
    let errors = 0;
    const limits = createRateLimiter(TABLE, {
      maxKeys: 10,
      onError: () => {
        errors += 1;
      },
      now: () => {
        calls += 1;
        if (calls > 1) throw new Error("clock broke");
        return 0;
      },
    });
    expect(limits.consume("login", { ip: ip("9.9.9.9") })).toEqual({ ok: false, retryAfterS: 1 });
    expect(errors).toBe(1);
  });
});

describe("policy table", () => {
  test("policy_table_validated", () => {
    const entry = { capacity: 1, refillPerSec: 1, scope: "ip" } as const;
    expect(() => definePolicies({ default: [{ ...entry, capacity: 0 }] })).toThrow(/capacity/);
    expect(() => definePolicies({ default: [{ ...entry, refillPerSec: 0 }] })).toThrow(/refillPerSec/);
    expect(() => definePolicies({ default: [] })).toThrow(/no entries/);
    expect(() => definePolicies({ login: [entry] })).toThrow(/default/);
    expect(() => createRateLimiter({ login: [entry] }, { maxKeys: 1, onError: () => undefined })).toThrow(/default/);
    const { limits } = limiter();
    expect(() => limits.consume("nope", { ip: null })).toThrow(/nope/);
  });
});
