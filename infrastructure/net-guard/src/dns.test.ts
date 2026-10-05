import { afterEach, describe, expect, test, vi } from "vitest";
import { NetGuardError, resolveTxt, type TxtResolver } from "../index.ts";

/** A stub resolver (DNS is an unmanaged dependency, TE-1) recording what it was built with and asked. */
function stub(answer: () => Promise<string[][]>) {
  const seen = {
    names: [] as string[],
    built: [] as { timeout: number; tries: number; maxTimeout: number }[],
    cancelled: 0,
  };
  const createResolver = (options: { timeout: number; tries: number; maxTimeout: number }): TxtResolver => {
    seen.built.push(options);
    return {
      resolveTxt: (name) => {
        seen.names.push(name);
        return answer();
      },
      cancel: () => {
        seen.cancelled++;
      },
    };
  };
  return { createResolver, seen };
}

const dnsError = (code: string) => Object.assign(new Error(`queryTxt ${code}`), { code });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NetGuardError) return error.code;
    throw error;
  }
  throw new Error("expected a NetGuardError");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveTxt", () => {
  test("resolve_txt_ok", async () => {
    const records = [["did=did:plc:ewvi7nxzyoun6zhxrhs64oiz"], ["v=1 ", "two chunks"]];
    const { createResolver, seen } = stub(async () => records);
    expect(await resolveTxt("_atproto.alice.example", { timeoutMs: 2_000, createResolver })).toEqual(records);
    expect(seen).toEqual({
      names: ["_atproto.alice.example"],
      built: [{ timeout: 1_000, tries: 2, maxTimeout: 1_000 }],
      cancelled: 0,
    });
  });

  test("resolve_txt_timeout", async () => {
    vi.useFakeTimers();
    const { createResolver, seen } = stub(() => new Promise(() => undefined));
    const result = codeOf(resolveTxt("_atproto.slow.example", { timeoutMs: 2_000, createResolver }));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(seen.cancelled).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("egress.dns_timeout");
    expect(seen.cancelled).toBe(1);
  });

  test("resolver_timeout_is_dns_timeout", async () => {
    const { createResolver } = stub(async () => Promise.reject(dnsError("ETIMEOUT")));
    expect(await codeOf(resolveTxt("_atproto.x.example", { timeoutMs: 2_000, createResolver }))).toBe(
      "egress.dns_timeout",
    );
  });

  test("caller_deadline_aborts", async () => {
    const controller = new AbortController();
    const { createResolver, seen } = stub(() => new Promise(() => undefined));
    const result = codeOf(
      resolveTxt("_atproto.x.example", { timeoutMs: 60_000, signal: controller.signal, createResolver }),
    );
    controller.abort();
    expect(await result).toBe("egress.dns_timeout");
    expect(seen.cancelled).toBe(1);
    const aborted = stub(async () => []);
    expect(await codeOf(resolveTxt("x.example", { timeoutMs: 1, signal: controller.signal, ...aborted }))).toBe(
      "egress.dns_timeout",
    );
    expect(aborted.seen.names).toEqual([]);
  });

  test("resolve_txt_nodata", async () => {
    for (const answer of [
      () => Promise.reject(dnsError("ENODATA")),
      () => Promise.reject(dnsError("ENOTFOUND")),
      async () => [],
    ]) {
      const { createResolver } = stub(answer);
      expect(await codeOf(resolveTxt("_atproto.none.example", { timeoutMs: 2_000, createResolver }))).toBe(
        "egress.dns_no_record",
      );
    }
  });

  test("other_failures_are_dns_failed", async () => {
    const answers = [
      () => Promise.reject(dnsError("ESERVFAIL")),
      () => Promise.reject(dnsError("ECONNREFUSED")),
      () => Promise.reject("not an error"),
      () => {
        throw new Error("synchronous");
      },
    ];
    for (const answer of answers) {
      const { createResolver } = stub(answer);
      expect(await codeOf(resolveTxt("_atproto.x.example", { timeoutMs: 2_000, createResolver }))).toBe(
        "egress.dns_failed",
      );
    }
  });

  test("resolve_txt_bad_name", async () => {
    const names = [
      "",
      ".",
      "a..b",
      "-a.example",
      "a-.example",
      "a b.example",
      "a\u0000.example",
      "é.example",
      "a.example.",
      `${"a".repeat(64)}.example`,
      `${"a.".repeat(126)}ab`,
    ];
    for (const name of names) {
      const { createResolver, seen } = stub(async () => [["x"]]);
      expect(await codeOf(resolveTxt(name, { timeoutMs: 2_000, createResolver })), JSON.stringify(name)).toBe(
        "egress.dns_failed",
      );
      expect(seen.built, JSON.stringify(name)).toEqual([]);
    }
    const longest = `${"a.".repeat(125)}abc`; // 253 characters
    const { createResolver } = stub(async () => [["x"]]);
    expect(await resolveTxt(longest, { timeoutMs: 2_000, createResolver })).toEqual([["x"]]);
  });
});
