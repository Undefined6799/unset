// Web addresses a member types for visitors to follow (ADR 0051). Staging break test 2026-11-21, item 6: a link to
// the visitor's own machine or network was accepted. Visitors' browsers follow these links, never our server.
import { describe, expect, test } from "vitest";
import { isWebAddress, withScheme } from "./web-address.ts";

describe("isWebAddress", () => {
  test("public http and https addresses, by name or address, are web addresses", () => {
    for (const text of [
      "https://alice.dev",
      "http://old-site.example/page?q=1",
      "https://93.184.215.14/",
      "https://[2606:4700::1111]/",
      "https://[fc::1]/",
      "https://localhost.example.com/",
    ]) {
      expect(isWebAddress(text)).toBe(true);
    }
  });

  test("other schemes, credentials and missing hosts are not", () => {
    for (const text of ["javascript:alert(1)", "ftp://x.example", "https://a:b@x.example", "https://", "data:,x"]) {
      expect(isWebAddress(text)).toBe(false);
    }
  });

  test("an address on the visitor's own machine or local network is not", () => {
    for (const text of [
      "https://127.0.0.1/admin",
      "http://127.1/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://0.0.0.0/",
      "http://10.0.0.1/",
      "http://172.16.5.4/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:192.168.0.1]/",
      "http://localhost/",
      "http://LOCALHOST./",
      "http://app.localhost/",
      "http://printer.local/",
      "http://nas.home.arpa/",
      "http://db.internal/",
    ]) {
      expect(isWebAddress(text), text).toBe(false);
    }
  });

  test("addresses just outside the private ranges are still web addresses", () => {
    for (const text of ["http://172.15.0.1/", "http://172.32.0.1/", "http://100.128.0.1/", "http://11.0.0.1/"]) {
      expect(isWebAddress(text), text).toBe(true);
    }
  });
});

test("withScheme adds https to a bare address only", () => {
  expect(withScheme("alice.dev")).toBe("https://alice.dev");
  expect(withScheme("http://alice.dev")).toBe("http://alice.dev");
});
