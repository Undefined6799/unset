// The trusted proxy (P1.05): the client address from the one configured header, only from the edge, rightmost first.
import { describe, expect, test } from "vitest";
import { createClientIpResolver, type ProxySettings } from "./trustedProxy.ts";

const HEADER: ProxySettings = {
  TRUSTED_PROXY_MODE: "header",
  TRUSTED_PROXY_HEADER: "x-forwarded-for",
  TRUSTED_PROXY_CIDRS: ["10.0.0.0/8", "fd00::/8"],
  TRUSTED_PROXY_HOPS: 1,
};
const EDGE = "10.0.0.2";

function resolver(settings: Partial<ProxySettings> = {}) {
  let untrusted = 0;
  const resolve = createClientIpResolver({ ...HEADER, ...settings }, () => {
    untrusted += 1;
  });
  /** The resolved rate key; `peer` null means the socket gave no address. */
  const key = (headers: Record<string, string> | Headers, peer: string | null = EDGE) =>
    resolve(headers instanceof Headers ? headers : new Headers(headers), peer ?? undefined)?.rateKey() ?? null;
  return { key, untrusted: () => untrusted };
}

describe("header mode", () => {
  test("header_rightmost", () => {
    const { key } = resolver();
    expect(key({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })).toBe("9.9.9.9");
    expect(key({ "x-forwarded-for": "9.9.9.9" })).toBe("9.9.9.9");
  });

  test("header_ignored_from_untrusted_peer", () => {
    const { key, untrusted } = resolver();
    expect(key({ "x-forwarded-for": "9.9.9.9" }, "203.0.113.7")).toBeNull();
    expect(untrusted()).toBe(1);
  });

  test("other_headers_ignored", () => {
    const { key } = resolver();
    const forged = {
      "x-real-ip": "9.9.9.9",
      forwarded: "for=9.9.9.9",
      "cf-connecting-ip": "9.9.9.9",
      "true-client-ip": "9.9.9.9",
      "x-client-ip": "9.9.9.9",
    };
    expect(key(forged)).toBeNull();
    expect(key({ ...forged, "x-forwarded-for": "8.8.8.8" })).toBe("8.8.8.8");
  });

  test("double_hop", () => {
    expect(resolver({ TRUSTED_PROXY_HOPS: 2 }).key({ "x-forwarded-for": "9.9.9.9, 10.0.0.5" })).toBe("9.9.9.9");
    expect(resolver({ TRUSTED_PROXY_HOPS: 1 }).key({ "x-forwarded-for": "9.9.9.9, 10.0.0.5" })).toBeNull();
  });

  test("all_trusted_is_null", () => {
    expect(resolver({ TRUSTED_PROXY_HOPS: 3 }).key({ "x-forwarded-for": "10.0.0.4, 10.0.0.5" })).toBeNull();
  });

  test.each(["unknown", "evil.example", "1.2.3.4%eth0", "999.1.1.1", "_hidden", "", " , "])(
    "garbage_is_null %s",
    (value) => {
      expect(resolver().key({ "x-forwarded-for": value })).toBeNull();
    },
  );

  test("ipv4_with_port", () => {
    expect(resolver().key({ "x-forwarded-for": "1.2.3.4:5678" })).toBe("1.2.3.4");
  });

  test("ipv6_entries", () => {
    const { key } = resolver();
    expect(key({ "x-forwarded-for": "[2001:db8:1:2::9]:443" })).toBe("2001:0db8:0001:0002::/64");
    expect(key({ "x-forwarded-for": "2001:db8:1:2::9" })).toBe("2001:0db8:0001:0002::/64");
    expect(key({ "x-forwarded-for": "::ffff:192.0.2.1" })).toBe("192.0.2.1");
  });

  test("repeated_header_lines_are_one_list", () => {
    const headers = new Headers();
    headers.append("x-forwarded-for", "1.1.1.1");
    headers.append("x-forwarded-for", "9.9.9.9");
    expect(resolver().key(headers)).toBe("9.9.9.9");
  });

  test("trusted_peer_mapped_v4", () => {
    expect(resolver().key({ "x-forwarded-for": "9.9.9.9" }, "::ffff:10.0.0.2")).toBe("9.9.9.9");
  });

  test("missing_peer_is_null", () => {
    expect(resolver().key({ "x-forwarded-for": "9.9.9.9" }, null)).toBeNull();
  });

  test("exception_is_null", () => {
    const { key } = resolver();
    const broken = Object.defineProperty(new Headers(), "get", {
      value: () => {
        throw new Error("boom");
      },
    });
    expect(key(broken)).toBeNull();
  });
});

describe("socket mode", () => {
  test("mapped_v4_socket", () => {
    const resolve = createClientIpResolver({ ...HEADER, TRUSTED_PROXY_MODE: "socket" }, () => undefined);
    const ip = resolve(new Headers(), "::ffff:192.0.2.1");
    expect(ip?.kind).toBe("v4");
    expect(ip?.rateKey()).toBe("192.0.2.1");
  });

  test("socket_mode_ignores_headers", () => {
    const { key } = resolver({ TRUSTED_PROXY_MODE: "socket" });
    expect(key({ "x-forwarded-for": "9.9.9.9" }, "100.64.0.7")).toBe("100.64.0.7");
  });
});
