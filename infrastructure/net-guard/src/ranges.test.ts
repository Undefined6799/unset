import { describe, expect, test } from "vitest";
import { classifyAddress } from "../index.ts";
import { RANGES } from "./ranges.ts";

/** The first address of a CIDR block, and one inside it past the first. */
function samples(cidr: string): string[] {
  const [base = "", bits = ""] = cidr.split("/");
  if (base.includes(":")) return [base.endsWith("::") && bits !== "128" ? `${base}1` : base];
  const octets = base.split(".").map(Number);
  const inside = [...octets.slice(0, 3), Math.min((octets[3] ?? 0) + 1, 255)].join(".");
  return [base, inside];
}

describe("special_ranges_parametrised", () => {
  test.each(RANGES.flatMap((row) => samples(row.cidr).map((ip) => [row.cidr, ip, row.class] as const)))(
    "%s: %s is %s",
    (_cidr, ip, cls) => {
      expect(classifyAddress(ip)).toBe(cls);
    },
  );

  test.each([
    ["mapped, dotted", "::ffff:169.254.169.254"],
    ["mapped, hex", "::ffff:a9fe:a9fe"],
    ["mapped, bracketed", "[::ffff:a9fe:a9fe]"],
    ["mapped loopback", "::ffff:127.0.0.1"],
    ["compatible, dotted", "::10.0.0.1"],
    ["compatible, hex", "::a00:1"],
    ["NAT64 metadata", "64:ff9b::a9fe:a9fe"],
    ["NAT64 dotted", "64:ff9b::10.1.2.3"],
    ["6to4 metadata", "2002:a9fe:a9fe::"],
    ["6to4 loopback", "2002:7f00:1::1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["zone id on link-local", "fe80::1%eth0"],
  ])("embedded_and_special_forms %s", (_kind, ip) => {
    expect(classifyAddress(ip)).not.toBe("public");
  });

  test.each([
    "1.1.1.1",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::",
  ])("public %s", (ip) => {
    expect(classifyAddress(ip)).toBe("public");
  });

  test.each(["", "example.com", "127.attacker.example", "999.1.1.1", "::g"])("not_an_address %s", (value) => {
    expect(classifyAddress(value)).toBe("reserved");
  });

  test("every range parses and has a known class", () => {
    for (const row of RANGES) {
      expect(row.cidr, row.cidr).toMatch(/\/\d{1,3}$/);
      expect(["private", "loopback", "reserved"]).toContain(row.class);
    }
  });
});
