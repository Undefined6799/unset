// The prototype's 23 net-guard tests (0x40 net-guard/net-guard.test.ts:11-262), ported to Vitest with their names.
// The prototype had one predicate for names and addresses (isPrivateOrMetadataIp), a loopback opt-in and message
// labels; here an address goes to classifyAddress, a name to isInternalName, loopback is the `allow: "private"` mode
// and a refusal is a NetGuardError code. Each case keeps its inputs and what it proves.
import { isIP } from "node:net";
import { describe, expect, test } from "vitest";
import {
  classifyAddress,
  isInternalName,
  NetGuardError,
  normaliseHost,
  pinnedLookup,
  resolveVetted,
} from "../index.ts";

const notPublic = (value: string): boolean =>
  isIP(normaliseHost(value)) !== 0 ? classifyAddress(value) !== "public" : isInternalName(value);
const lookupOf =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: 4 }));
const refusal = async (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof NetGuardError ? error.code : String(error)),
  );

describe("isPrivateOrMetadataIp", () => {
  test("blocks every private / link-local / CGNAT / metadata IPv4 range", () => {
    for (const ip of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "127.0.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "100.127.255.255",
    ]) {
      expect(notPublic(ip), ip).toBe(true);
    }
  });

  test("allows ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.63.255.255"]) {
      expect(notPublic(ip), ip).toBe(false);
    }
  });

  test("blocks IPv6 private forms and IPv4-mapped addresses in both notations", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "::ffff:a9fe:a9fe",
      "[::ffff:a9fe:a9fe]",
    ]) {
      expect(notPublic(ip), ip).toBe(true);
    }
  });

  test("blocks internal suffixes even fully-qualified with a trailing dot", () => {
    for (const host of ["metadata.google.internal.", "pds.internal.", "printer.local.", "evil.localhost."]) {
      expect(notPublic(host), host).toBe(true);
    }
  });

  test("blocks IPv6 tunnel and multicast prefixes that reach IPv4 space", () => {
    for (const ip of [
      "2002:7f00:1::",
      "2002:a9fe:a9fe::",
      "64:ff9b::7f00:1",
      "2001:0:0:0:0:0:7f00:1",
      "::7f00:1",
      "::127.0.0.1",
      "ff02::1",
    ]) {
      expect(notPublic(ip), ip).toBe(true);
    }
  });

  test("blocks IPv4 multicast and reserved space", () => {
    for (const ip of ["224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255"]) {
      expect(notPublic(ip), ip).toBe(true);
    }
    expect(notPublic("223.255.255.255")).toBe(false);
  });

  test("strips an IPv6 zone id so it cannot hide a link-local", () => {
    expect(notPublic("fe80::1%eth0")).toBe(true);
  });

  test("does not over-block ordinary public addresses", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1",
      "100.63.255.255",
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
    ]) {
      expect(notPublic(ip), ip).toBe(false);
    }
  });

  test("blocks internal-only DNS suffixes and metadata names", () => {
    for (const host of [
      "metadata.google.internal",
      "instance-data",
      "pds.internal",
      "printer.local",
      "foo.localhost",
    ]) {
      expect(notPublic(host), host).toBe(true);
    }
    expect(notPublic("plc.directory")).toBe(false);
    expect(notPublic("0x40.space")).toBe(false);
  });
});

describe("mappedIpv4", () => {
  test("decodes both notations and ignores non-mapped input", () => {
    // The prototype's helper is internal now; what it decoded must classify as the embedded address would.
    expect(classifyAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyAddress("::ffff:7f00:1")).toBe("loopback");
    expect(classifyAddress("::ffff:a9fe:a9fe")).toBe(classifyAddress("169.254.169.254"));
    expect(classifyAddress("fc00::1")).toBe("private");
    expect(classifyAddress("8.8.8.8")).toBe("public");
  });
});

describe("isLoopbackHost", () => {
  test("matches loopback names and the whole 127/8 block", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "::1"]) expect(classifyAddress(ip), ip).toBe("loopback");
    expect(isInternalName("localhost")).toBe(true);
    expect(isInternalName("example.com")).toBe(false);
    expect(classifyAddress("128.0.0.1")).toBe("public");
  });
});

describe("resolvePinnedAddresses", () => {
  test("returns the vetted address for a public name", async () => {
    expect(await resolveVetted("example.com", { allow: "public" }, { lookup: lookupOf("93.184.216.34") })).toEqual([
      "93.184.216.34",
    ]);
  });

  test("refuses a public name that resolves into private space", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "100.64.0.1"]) {
      const result = resolveVetted("rebind.example.com", { allow: "public" }, { lookup: lookupOf(address) });
      expect(await refusal(result), address).toBe("egress.private_address");
    }
  });

  test("refuses when ANY answer in a multi-record response is private", async () => {
    const lookup = lookupOf("93.184.216.34", "169.254.169.254");
    expect(await refusal(resolveVetted("mixed.example.com", { allow: "public" }, { lookup }))).toBe(
      "egress.private_address",
    );
  });

  test("refuses a private literal IP, and an empty DNS answer", async () => {
    expect(await refusal(resolveVetted("169.254.169.254", { allow: "public" }))).toBe("egress.private_address");
    expect(await refusal(resolveVetted("nx.example.com", { allow: "public" }, { lookup: lookupOf() }))).toBe(
      "egress.dns_failed",
    );
  });

  test("allows loopback only when the caller opts in", async () => {
    expect(await resolveVetted("127.0.0.1", { allow: "private" })).toEqual(["127.0.0.1"]);
    expect(await refusal(resolveVetted("127.0.0.1", { allow: "public" }))).toBe("egress.private_address");
  });

  test("uses the caller's label in the message", async () => {
    // Labels became codes: the refusal names its reason, never the host (hosts can name a user's PDS).
    const error = await resolveVetted("10.0.0.1", { allow: "public" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetGuardError);
    expect((error as NetGuardError).message).toBe("egress.private_address");
    expect(String(error)).not.toContain("10.0.0.1");
  });
});

describe("pinnedLookup", () => {
  const addresses = ["93.184.216.34", "93.184.216.35"];

  test("yields the first address in single mode", () => {
    const got: unknown[] = [];
    pinnedLookup(addresses)("ignored.example.com", {}, (...args) => got.push(...args));
    expect(got).toEqual([null, "93.184.216.34", 4]);
  });

  test("yields every address in all mode", () => {
    const got: unknown[] = [];
    pinnedLookup(addresses)("ignored.example.com", { all: true }, (...args) => got.push(...args));
    expect(got).toEqual([null, addresses.map((address) => ({ address, family: 4 }))]);
  });

  test("ignores the hostname it is asked to resolve", () => {
    const got: unknown[] = [];
    pinnedLookup(addresses)("evil.example.com", {}, (...args) => got.push(...args));
    expect(got[1]).toBe("93.184.216.34");
  });
});

describe("isLoopbackHost only matches real loopback destinations", () => {
  test("does not treat a 127-prefixed HOSTNAME as loopback", () => {
    for (const host of ["127.attacker.com", "127.0.0.1.evil.test", "localhost.evil.test"]) {
      expect(classifyAddress(host), host).not.toBe("loopback");
      expect(isInternalName(host), host).toBe(false);
    }
  });

  test("still matches genuine loopback literals and names", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "::1"]) expect(classifyAddress(ip), ip).toBe("loopback");
    expect(isInternalName("localhost")).toBe(true);
  });

  test("a 127-prefixed hostname is DNS-resolved and vetted, not short-circuited", async () => {
    let asked = false;
    const lookup = async () => {
      asked = true;
      return [{ address: "169.254.169.254", family: 4 }];
    };
    // Link-local (the metadata address) is never "private": even an internal-only policy refuses it.
    expect(await refusal(resolveVetted("127.attacker.com", { allow: "private" }, { lookup }))).toBe(
      "egress.private_address",
    );
    expect(asked).toBe(true);
    expect(await refusal(resolveVetted("127.attacker.com", { allow: "public" }, { lookup }))).toBe(
      "egress.private_address",
    );
  });
});
