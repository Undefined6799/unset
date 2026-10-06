// Review-found gaps (P1.18): expected classes written out by hand, so deleting or narrowing a table row turns a test
// red, plus the resolver and lookup cases a review proved by running code.
import { afterEach, describe, expect, test, vi } from "vitest";
import { classifyAddress, isInternalName, NetGuardError, pinnedLookup } from "../index.ts";
// The seamed entry: these cases stub the resolver, which the package entry no longer accepts (P2.01m).
import { resolveVettedWith as resolveVetted } from "./resolve.ts";

afterEach(() => {
  vi.useRealTimers();
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NetGuardError) return error.code;
    throw error;
  }
  return "resolved";
}

// First, last and just outside for each row whose edges a mutation could move.
const EXPECTED: readonly (readonly [string, string])[] = [
  ["0.255.255.255", "reserved"],
  ["1.0.0.0", "public"],
  ["9.255.255.255", "public"],
  ["10.255.255.255", "private"],
  ["11.0.0.0", "public"],
  ["100.63.255.255", "public"],
  ["100.127.255.255", "reserved"],
  ["100.128.0.0", "public"],
  ["127.255.255.255", "loopback"],
  ["128.0.0.0", "public"],
  ["169.254.255.255", "reserved"],
  ["169.255.0.0", "public"],
  ["172.15.255.255", "public"],
  ["172.31.255.255", "private"],
  ["172.32.0.0", "public"],
  ["192.0.0.255", "reserved"],
  ["192.0.1.0", "public"],
  ["192.0.2.255", "reserved"],
  ["192.0.3.0", "public"],
  ["192.88.99.255", "reserved"],
  ["192.88.100.0", "public"],
  ["192.167.255.255", "public"],
  ["192.168.255.255", "private"],
  ["192.169.0.0", "public"],
  ["198.17.255.255", "public"],
  ["198.19.255.255", "reserved"],
  ["198.20.0.0", "public"],
  ["198.51.100.255", "reserved"],
  ["198.51.101.0", "public"],
  ["203.0.113.255", "reserved"],
  ["203.0.114.0", "public"],
  ["223.255.255.255", "public"],
  ["239.255.255.255", "reserved"],
  ["255.255.255.254", "reserved"],
  ["::", "reserved"],
  ["::1", "loopback"],
  ["::1:0:0", "public"],
  ["64:ff9b:1:ffff::", "reserved"],
  ["64:ff9b:2::", "public"],
  ["100::ffff:ffff:ffff:ffff", "reserved"],
  ["100:0:0:1::", "public"],
  ["2001:1ff:ffff::", "reserved"],
  ["2001:200::", "public"],
  ["2001:db8:ffff::", "reserved"],
  ["2001:db9::", "public"],
  ["3fff:fff::", "reserved"],
  ["3fff:1000::", "public"],
  ["5f00:ffff::", "reserved"],
  ["5f01::", "public"],
  ["fbff:ffff::", "public"],
  ["fc00::", "private"],
  ["fdff:ffff::", "private"],
  ["fe00::", "public"],
  ["fe80::", "reserved"],
  ["febf:ffff::", "reserved"],
  ["fec0::", "reserved"],
  ["feff:ffff::", "reserved"],
  ["ff00::", "reserved"],
  ["ffff:ffff::", "reserved"],
  ["::ffff:0:a9fe:a9fe", "reserved"],
  ["::ffff:0:7f00:1", "reserved"],
];

describe("classification by hand-written expectations", () => {
  test.each(EXPECTED)("%s is %s", (ip, cls) => {
    expect(classifyAddress(ip)).toBe(cls);
  });

  test.each([
    ["169.254.169.254", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe"],
    ["10.0.0.1", "::ffff:a00:1", "64:ff9b::10.0.0.1"],
  ])("mapped_and_nat64_match_ipv4 %s", (v4, mapped, nat64) => {
    expect(classifyAddress(mapped)).toBe(classifyAddress(v4));
    expect(classifyAddress(nat64)).toBe(classifyAddress(v4));
  });

  // A deterministic sweep, not fast-check: net-guard-leaf keeps every package but undici out of this folder, tests
  // included. 65 536 addresses spread over the whole IPv4 space, plus each range edge from EXPECTED.
  const sweep = [
    ...Array.from({ length: 65_536 }, (_, i) => (i * 65_537 + 12_345) >>> 0),
    ...EXPECTED.map(([ip]) => ip)
      .filter((ip) => !ip.includes(":"))
      .map((ip) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0)),
  ];

  test("property: mapped and spelled-out forms classify as the IPv4 address", () => {
    for (const n of sweep) {
      const v4 = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
      const hex = `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
      const cls = classifyAddress(v4);
      if (classifyAddress(`::ffff:${v4}`) !== cls || classifyAddress(`0:0:0:0:0:FFFF:${hex}`) !== cls) {
        expect.fail(`${v4} classifies differently in mapped form`);
      }
      if (classifyAddress(`[64:ff9b::${hex}]`) !== cls) expect.fail(`${v4} classifies differently in NAT64 form`);
    }
  });

  test("property: an IPv6 spelling does not change its class", () => {
    for (const [ip] of EXPECTED.filter(([value]) => value.includes(":"))) {
      const cls = classifyAddress(ip);
      expect(classifyAddress(ip.toUpperCase()), ip).toBe(cls);
      expect(classifyAddress(`[${ip}]`), ip).toBe(cls);
      expect(classifyAddress(`${ip}%eth0`), ip).toBe(cls);
    }
  });
});

describe("names", () => {
  test.each(["pds", "home.arpa", "x.home.arpa", "localhost..", "foo.internal..", "x.onion", "x.alt", "x.invalid"])(
    "internal %s",
    (name) => {
      expect(isInternalName(name)).toBe(true);
    },
  );

  test("zone ids are stripped from addresses only", async () => {
    const calls: string[] = [];
    const lookup = async (host: string) => {
      calls.push(host);
      return [{ address: "1.1.1.1", family: 4 }];
    };
    await resolveVetted("pds.internal%x.example.com", { allow: "public" }, { lookup });
    expect(calls).toEqual(["pds.internal%x.example.com"]);
  });
});

describe("resolveVetted review cases", () => {
  test("sync_throwing_lookup_is_dns_failed", async () => {
    vi.useFakeTimers();
    const throwing = (): Promise<never> => {
      throw new TypeError("ERR_INVALID_ARG_VALUE");
    };
    expect(await codeOf(resolveVetted("bad.example", { allow: "public" }, { lookup: throwing }))).toBe(
      "egress.dns_failed",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test("hosts_with_controls_or_spaces_refused", async () => {
    let asked = false;
    const lookup = async () => {
      asked = true;
      return [{ address: "1.1.1.1", family: 4 }];
    };
    for (const host of ["a\u0000b.example", "a b.example", "a\tb.example"]) {
      expect(await codeOf(resolveVetted(host, { allow: "public" }, { lookup })), host).toBe("egress.dns_failed");
    }
    expect(asked).toBe(false);
  });

  test("no_timer_left_after_answer", async () => {
    vi.useFakeTimers();
    await resolveVetted(
      "one.example",
      { allow: "public" },
      { lookup: async () => [{ address: "1.1.1.1", family: 4 }] },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test("private_mode_refuses_translated_forms", async () => {
    for (const address of ["2002:a00:1::", "2002:7f00:1::", "64:ff9b::7f00:1", "::7f00:1", "::a00:1"]) {
      const lookup = async () => [{ address, family: 6 }];
      expect(await codeOf(resolveVetted("pds.example", { allow: "private" }, { lookup })), address).toBe(
        "egress.private_address",
      );
    }
    const mapped = async () => [{ address: "::ffff:172.20.0.5", family: 6 }];
    expect(await resolveVetted("pds.example", { allow: "private" }, { lookup: mapped })).toEqual(["::ffff:172.20.0.5"]);
  });

  test("answers_must_be_plain_addresses", async () => {
    for (const address of ["[::1]", "127.0.0.1.", "1.1.1.1%x", "example.com"]) {
      const lookup = async () => [{ address, family: 4 }];
      const allow = address === "1.1.1.1%x" ? "public" : "private";
      expect(await codeOf(resolveVetted("x.example", { allow }, { lookup })), address).toBe("egress.dns_failed");
    }
  });

  test("caller_signal_aborts_lookup", async () => {
    const never = () => new Promise<never>(() => undefined);
    const controller = new AbortController();
    const result = codeOf(
      resolveVetted("slow.example", { allow: "public" }, { lookup: never, signal: controller.signal }),
    );
    controller.abort();
    expect(await result).toBe("egress.dns_timeout");
    expect(await codeOf(resolveVetted("1.1.1.1", { allow: "public" }, { signal: AbortSignal.abort() }))).toBe(
      "egress.dns_timeout",
    );
  });
});

describe("pinnedLookup review cases", () => {
  test("all_with_unmatched_family_is_not_found", () => {
    const got: unknown[] = [];
    pinnedLookup(["93.184.215.14"])("x", { all: true, family: 6 }, (...args) => got.push(...args));
    expect(got[0]).toBeInstanceOf(Error);
  });

  test("two_argument_form", () => {
    const got: unknown[] = [];
    pinnedLookup(["93.184.215.14"])("x", (...args: unknown[]) => got.push(...args));
    expect(got).toEqual([null, "93.184.215.14", 4]);
  });
});
