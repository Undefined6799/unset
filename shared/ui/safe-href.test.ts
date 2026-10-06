// safeHref (P1.24h; book P1.24 Outputs and Done when, `safeHref.table`, moved here from P2.20).
import { describe, expect, test } from "vitest";
import { type HrefScheme, safeHref } from "./safe-href.ts";

const ALL: HrefScheme[] = ["http:", "https:", "mailto:", "path"];

describe("safeHref.table", () => {
  test.each([
    ["javascript:alert(1)", ALL],
    ["JaVaScRiPt:alert(1)", ALL],
    [" javascript:alert(1)", ALL],
    ["java\tscript:alert(1)", ALL],
    ["data:text/html,<script>alert(1)</script>", ALL],
    ["vbscript:msgbox(1)", ALL],
    ["//evil.example/", ALL],
    ["/\\evil.example/", ALL],
    ["\\\\evil.example/", ALL],
    ["/\t/evil.example/", ALL],
    ["/\n/evil.example/", ALL],
    ["https://user:pass@a.example/", ALL],
    ["https://user@a.example/", ALL],
    ["http://:pass@a.example/", ALL],
    ["relative/path", ALL],
    ["/settings", ["http:", "https:"] as HrefScheme[]],
    ["https://a.example/", ["path"] as HrefScheme[]],
    ["mailto:a@a.example", ["https:"] as HrefScheme[]],
    ["ftp://a.example/", ALL],
    [`https://a.example/${"a".repeat(2000)}`, ALL],
    ["", ALL],
    ["   ", ALL],
    ["https://a.example/a\u2028b", ALL],
    ["https://a.example/a\u0085b", ALL],
    ["/\ud800", ALL],
    ["https://", ALL],
  ])("%j is refused", (raw, allow) => {
    expect(safeHref(raw, allow)).toBeNull();
  });

  test.each([
    ["HTTPS://A.EXAMPLE", ["https:"], "https://a.example/"],
    ["  https://a.example/x?y=1#z  ", ["https:"], "https://a.example/x?y=1#z"],
    ["http://a.example/a b", ["http:"], "http://a.example/a%20b"],
    ["https://a.example/../x", ["https:"], "https://a.example/x"],
    ["mailto:hello@a.example", ["mailto:"], "mailto:hello@a.example"],
    ["/settings", ["path"], "/settings"],
    ["/a/../b?c=d#e", ["path"], "/b?c=d#e"],
    ["/@alice", ["path"], "/@alice"],
    ["/", ["path"], "/"],
  ] as [string, HrefScheme[], string][])("%j is %j", (raw, allow, expected) => {
    expect(safeHref(raw, allow)).toBe(expected);
  });

  test("the length cap is 2000 characters after trimming", () => {
    const at = `https://a.example/${"a".repeat(2000 - "https://a.example/".length)}`;
    expect(safeHref(` ${at} `, ["https:"])).toBe(at);
    expect(safeHref(`${at}a`, ["https:"])).toBeNull();
  });

  test("the output is the parsed href, never the raw input", () => {
    const raw = "https://A.example:443/%7e";
    expect(safeHref(raw, ["https:"])).toBe("https://a.example/%7e");
  });
});
