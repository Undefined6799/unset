// The client address value (P1.05): it never prints, and IPv6 clients key by /64.
import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { ClientIp } from "./clientIp.ts";

describe("ClientIp", () => {
  test("not_printable", () => {
    const ip = ClientIp.parse("192.0.2.1");
    expect(String(ip)).toBe("[ip]");
    expect(`${ip}`).toBe("[ip]");
    expect(JSON.stringify({ ip })).toBe('{"ip":"[ip]"}');
    expect(inspect(ip)).toBe("[ip]");
    expect(inspect({ ip })).not.toContain("192.0.2.1");
  });

  test("ipv6_rate_key_is_64", () => {
    const a = ClientIp.parse("2001:db8:1:2:3:4:5:6");
    const b = ClientIp.parse("2001:db8:1:2:ffff::1");
    expect(a?.kind).toBe("v6");
    expect(a?.rateKey()).toBe("2001:0db8:0001:0002::/64");
    expect(b?.rateKey()).toBe(a?.rateKey());
    expect(ClientIp.parse("2001:db8:1:3::1")?.rateKey()).not.toBe(a?.rateKey());
    expect(ClientIp.parse("::1")?.rateKey()).toBe("0000:0000:0000:0000::/64");
  });

  test("ipv4_rate_key_is_the_address", () => {
    expect(ClientIp.parse("192.0.2.1")?.rateKey()).toBe("192.0.2.1");
    expect(ClientIp.parse("::ffff:192.0.2.1")?.kind).toBe("v4");
    expect(ClientIp.parse("::FFFF:192.0.2.1")?.rateKey()).toBe("192.0.2.1");
  });

  test.each(["unknown", "evil.example", "1.2.3.4%eth0", "fe80::1%eth0", "999.1.1.1", "01.2.3.4", "", " 1.2.3.4"])(
    "not_an_address_%s",
    (text) => {
      expect(ClientIp.parse(text)).toBeNull();
    },
  );
});
