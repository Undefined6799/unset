import { afterEach, describe, expect, test, vi } from "vitest";
import { NetGuardError, pinnedLookup, resolveVetted } from "../index.ts";

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
