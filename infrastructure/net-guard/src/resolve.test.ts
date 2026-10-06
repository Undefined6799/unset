import { Resolver } from "node:dns/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NetGuardError, pinnedLookup, resolveVetted as resolvePublicEntry } from "../index.ts";
// The seamed entry: most cases stub the resolver, which the package entry does not accept (P2.01m).
import { type AddressResolver, resolveVettedWith as resolveVetted } from "./resolve.ts";

type Answer = { address: string; family: number }[];
const answering = (...addresses: string[]) => {
  const calls: string[] = [];
  const lookup = async (host: string): Promise<Answer> => {
    calls.push(host);
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { lookup, calls };
};

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
  vi.restoreAllMocks();
});

describe("resolveVetted", () => {
  test("mixed_answers_refused", async () => {
    const { lookup } = answering("93.184.215.14", "10.0.0.1");
    expect(await codeOf(resolveVetted("mixed.example", { allow: "public" }, { lookup }))).toBe(
      "egress.private_address",
    );
  });

  test("private_mode_refuses_public", async () => {
    const { lookup } = answering("93.184.215.14");
    expect(await codeOf(resolveVetted("pds.example", { allow: "private" }, { lookup }))).toBe("egress.private_address");
  });

  test("private_mode_accepts_private_and_loopback", async () => {
    const { lookup } = answering("172.20.0.5", "127.0.0.1");
    expect(await resolveVetted("pds.example", { allow: "private" }, { lookup })).toEqual(["172.20.0.5", "127.0.0.1"]);
  });

  test("private_mode_refuses_reserved", async () => {
    const { lookup } = answering("192.0.2.1");
    expect(await codeOf(resolveVetted("pds.example", { allow: "private" }, { lookup }))).toBe("egress.private_address");
  });

  test("returns_resolver_order", async () => {
    const { lookup } = answering("2606:4700:4700::1111", "1.1.1.1");
    expect(await resolveVetted("one.example", { allow: "public" }, { lookup })).toEqual([
      "2606:4700:4700::1111",
      "1.1.1.1",
    ]);
  });

  test("dns_failed_on_error_or_empty", async () => {
    const failing = async (): Promise<Answer> => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await codeOf(resolveVetted("nx.example", { allow: "public" }, { lookup: failing }))).toBe(
      "egress.dns_failed",
    );
    expect(await codeOf(resolveVetted("nx.example", { allow: "public" }, { lookup: answering().lookup }))).toBe(
      "egress.dns_failed",
    );
  });

  test("dns_timeout", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<Answer>(() => undefined);
    const result = codeOf(resolveVetted("slow.example", { allow: "public" }, { lookup: never }));
    await vi.advanceTimersByTimeAsync(2_999);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("egress.dns_timeout");
  });

  test("late_answer_ignored_after_timeout", async () => {
    vi.useFakeTimers();
    let answer: (a: Answer) => void = () => undefined;
    const late = () =>
      new Promise<Answer>((resolve) => {
        answer = resolve;
      });
    const result = codeOf(resolveVetted("slow.example", { allow: "public" }, { lookup: late, timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    answer([{ address: "1.1.1.1", family: 4 }]);
    expect(await result).toBe("egress.dns_timeout");
  });

  test("literals_skip_dns_and_are_vetted", async () => {
    const { lookup, calls } = answering("1.1.1.1");
    expect(await resolveVetted("[2606:4700:4700::1111]", { allow: "public" }, { lookup })).toEqual([
      "2606:4700:4700::1111",
    ]);
    expect(await codeOf(resolveVetted("169.254.169.254", { allow: "public" }, { lookup }))).toBe(
      "egress.private_address",
    );
    expect(await codeOf(resolveVetted("[::ffff:a9fe:a9fe]", { allow: "public" }, { lookup }))).toBe(
      "egress.private_address",
    );
    expect(calls).toEqual([]);
  });

  test("names_are_normalised_before_lookup", async () => {
    const { lookup, calls } = answering("1.1.1.1");
    await resolveVetted("Example.COM.", { allow: "public" }, { lookup });
    expect(calls).toEqual(["example.com"]);
  });
});

describe("pinnedLookup", () => {
  test("pinned_lookup_both_shapes", () => {
    const lookup = pinnedLookup(["93.184.215.14", "2606:4700:4700::1111"]);
    const single: unknown[] = [];
    lookup("other.example", {}, (...args) => single.push(...args));
    expect(single).toEqual([null, "93.184.215.14", 4]);
    const all: unknown[] = [];
    lookup("other.example", { all: true }, (...args) => all.push(...args));
    expect(all).toEqual([
      null,
      [
        { address: "93.184.215.14", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
    ]);
  });

  test("pinned_lookup_honours_family", () => {
    const lookup = pinnedLookup(["93.184.215.14", "2606:4700:4700::1111"]);
    const v6: unknown[] = [];
    lookup("x", { family: 6 }, (...args) => v6.push(...args));
    expect(v6).toEqual([null, "2606:4700:4700::1111", 6]);
    const none: unknown[] = [];
    pinnedLookup(["93.184.215.14"])("x", { family: 6 }, (...args) => none.push(...args));
    expect(none[0]).toBeInstanceOf(Error);
  });

  test("pinned_lookup_refuses_unvetted_input", () => {
    expect(() => pinnedLookup([])).toThrow();
    expect(() => pinnedLookup(["example.com"])).toThrow();
  });
});

/** A stub c-ares resolver (DNS is an unmanaged dependency, TE-1): each family answers addresses or fails with a code. */
function caresAnswering(v4: string[] | string, v6: string[] | string, delayMs = 0) {
  const seen = {
    built: [] as { timeout: number; tries: number; maxTimeout: number }[],
    names: [] as string[],
    cancelled: 0,
  };
  const answer = (value: string[] | string) =>
    new Promise<string[]>((resolve, reject) => {
      setTimeout(() => {
        if (typeof value === "string") reject(Object.assign(new Error(`query ${value}`), { code: value }));
        else resolve(value);
      }, delayMs);
    });
  const createResolver = (options: { timeout: number; tries: number; maxTimeout: number }): AddressResolver => {
    seen.built.push(options);
    return {
      resolve4: (name) => {
        seen.names.push(`4:${name}`);
        return answer(v4);
      },
      resolve6: (name) => {
        seen.names.push(`6:${name}`);
        return answer(v6);
      },
      cancel: () => {
        seen.cancelled++;
      },
    };
  };
  return { createResolver, seen };
}

describe("resolveVetted on c-ares (public names, P2.01m)", () => {
  test("public_names_use_both_families", async () => {
    const { createResolver, seen } = caresAnswering(["93.184.215.14"], ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"]);
    expect(await resolveVetted("Example.COM", { allow: "public" }, { createResolver, timeoutMs: 2000 })).toEqual([
      "93.184.215.14",
      "2606:2800:21f:cb07:6820:80da:af6b:8b2c",
    ]);
    expect(seen.names.sort()).toEqual(["4:example.com", "6:example.com"]);
    expect(seen.built).toEqual([{ timeout: 1000, tries: 2, maxTimeout: 1000 }]);
  });

  test("one_family_is_enough", async () => {
    const { createResolver } = caresAnswering(["93.184.215.14"], "ENODATA");
    expect(await resolveVetted("example.com", { allow: "public" }, { createResolver })).toEqual(["93.184.215.14"]);
  });

  test("no_record_on_nxdomain", async () => {
    const { createResolver } = caresAnswering("ENOTFOUND", "ENOTFOUND");
    expect(await codeOf(resolveVetted("nx.example.com", { allow: "public" }, { createResolver }))).toBe(
      "egress.dns_no_record",
    );
  });

  test("no_record_on_nodata_both", async () => {
    for (const [v4, v6] of [
      ["ENODATA", "ENODATA"],
      ["ENOTFOUND", "ENODATA"],
    ] as const) {
      const { createResolver } = caresAnswering(v4, v6);
      expect(await codeOf(resolveVetted("a.example.com", { allow: "public" }, { createResolver }))).toBe(
        "egress.dns_no_record",
      );
    }
    const empty = caresAnswering([], []);
    expect(
      await codeOf(resolveVetted("a.example.com", { allow: "public" }, { createResolver: empty.createResolver })),
    ).toBe("egress.dns_no_record");
  });

  test("one_family_error_fails_closed", async () => {
    for (const [v4, v6] of [
      [["93.184.215.14"], "ESERVFAIL"],
      ["ETIMEOUT", ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"]],
      ["ENOTFOUND", "EREFUSED"],
    ] as const) {
      const { createResolver } = caresAnswering(v4 as string[] | string, v6 as string[] | string);
      expect(await codeOf(resolveVetted("a.example.com", { allow: "public" }, { createResolver }))).toBe(
        "egress.dns_failed",
      );
    }
  });

  test("mixed_answers_refused_on_cares", async () => {
    const { createResolver } = caresAnswering(["93.184.215.14"], ["fd00::1"]);
    expect(await codeOf(resolveVetted("a.example.com", { allow: "public" }, { createResolver }))).toBe(
      "egress.private_address",
    );
    const v4 = caresAnswering(["93.184.215.14", "10.0.0.1"], "ENODATA");
    expect(
      await codeOf(resolveVetted("a.example.com", { allow: "public" }, { createResolver: v4.createResolver })),
    ).toBe("egress.private_address");
  });

  test("malformed_answer_fails", async () => {
    const { createResolver } = caresAnswering(["93.184.215.014"], "ENODATA");
    expect(await codeOf(resolveVetted("a.example.com", { allow: "public" }, { createResolver }))).toBe(
      "egress.dns_failed",
    );
  });

  test("timeout_cancels_the_query", async () => {
    vi.useFakeTimers();
    const { createResolver, seen } = caresAnswering(["93.184.215.14"], [], 10_000);
    const pending = codeOf(resolveVetted("slow.example.com", { allow: "public" }, { createResolver, timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe("egress.dns_timeout");
    expect(seen.cancelled).toBe(1);
  });

  test("private_mode_uses_lookup", async () => {
    // Internal names may live in /etc/hosts, which c-ares skips: private mode keeps dns.lookup.
    const { createResolver, seen } = caresAnswering(["93.184.215.14"], []);
    expect(await resolveVetted("localhost", { allow: "private" }, { createResolver })).toContain("127.0.0.1");
    expect(seen.built).toEqual([]);
  });

  test("a_lookup_stub_replaces_both_resolvers", async () => {
    const { lookup, calls } = answering("93.184.215.14");
    const { createResolver, seen } = caresAnswering(["1.1.1.1"], []);
    expect(await resolveVetted("example.com", { allow: "public" }, { lookup, createResolver })).toEqual([
      "93.184.215.14",
    ]);
    expect(calls).toEqual(["example.com"]);
    expect(seen.built).toEqual([]);
  });

  test("literals_skip_cares", async () => {
    const { createResolver, seen } = caresAnswering(["1.1.1.1"], []);
    expect(await resolveVetted("93.184.215.14", { allow: "public" }, { createResolver })).toEqual(["93.184.215.14"]);
    expect(seen.built).toEqual([]);
  });
});

describe("default resolvers, no seam (P2.01m)", () => {
  // The seams above could hide a regression to the threadpool path, so these use the package entry with nothing
  // stubbed but the c-ares Resolver's own methods: no network, and dns.lookup still runs for real.
  test("public_mode_calls_only_cares", async () => {
    const v4 = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["93.184.215.14"]);
    const v6 = vi.spyOn(Resolver.prototype, "resolve6").mockResolvedValue([]);
    // `.invalid` never resolves through dns.lookup, so this answer can only have come from c-ares.
    expect(await resolvePublicEntry("only-cares.invalid", { allow: "public" })).toEqual(["93.184.215.14"]);
    expect(v4).toHaveBeenCalledWith("only-cares.invalid");
    expect(v6).toHaveBeenCalledWith("only-cares.invalid");
  });

  test("private_mode_calls_only_lookup", async () => {
    const v4 = vi.spyOn(Resolver.prototype, "resolve4");
    const v6 = vi.spyOn(Resolver.prototype, "resolve6");
    // localhost comes from /etc/hosts through dns.lookup; c-ares is never asked.
    expect(await resolvePublicEntry("localhost", { allow: "private" })).toContain("127.0.0.1");
    expect(v4).not.toHaveBeenCalled();
    expect(v6).not.toHaveBeenCalled();
  });

  test("package_entry_ignores_seams", async () => {
    const v4 = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["93.184.215.14"]);
    vi.spyOn(Resolver.prototype, "resolve6").mockResolvedValue([]);
    const lookup = async () => [{ address: "10.0.0.1", family: 4 }];
    const options = { lookup } as Parameters<typeof resolvePublicEntry>[2];
    expect(await resolvePublicEntry("a.example.com", { allow: "public" }, options)).toEqual(["93.184.215.14"]);
    expect(v4).toHaveBeenCalled();
  });
});
