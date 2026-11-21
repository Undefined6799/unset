// The CSRF gate (plan §2 rule 14; P1.07's gate, back in the kit for the unset.cc door): only a same-origin request
// other than GET or HEAD passes, decided by Sec-Fetch-Site, then an exact Origin, then an exact Referer.
import { describe, expect, test } from "vitest";
import { createCsrfGate } from "./csrf.ts";

const ORIGIN = "https://unset.cc";
const gate = createCsrfGate(ORIGIN);
const post = (headers: Record<string, string>) =>
  gate(new Request(`${ORIGIN}/sign-in/redeem`, { method: "POST", headers }));
const denied = (reason: string) => ({ ok: false, reason });

describe("csrf gate", () => {
  test("sfs_same_origin_allows", () => {
    expect(post({ "sec-fetch-site": "same-origin" })).toEqual({ ok: true });
  });

  test("sfs_cross_and_same_site_deny, whatever the Origin says", () => {
    expect(post({ "sec-fetch-site": "cross-site", origin: ORIGIN })).toEqual(denied("sfs_cross_site"));
    // staging.unset.cc shares unset.cc's site and is never trusted (rule 14: never by site).
    expect(post({ "sec-fetch-site": "same-site", origin: "https://staging.unset.cc" })).toEqual(
      denied("sfs_same_site"),
    );
  });

  test("sfs_none_then_origin", () => {
    expect(post({ "sec-fetch-site": "none", origin: ORIGIN })).toEqual({ ok: true });
    expect(post({ "sec-fetch-site": "none" })).toEqual(denied("no_signal"));
    expect(post({})).toEqual(denied("no_signal"));
  });

  test("origin_exact_allows", () => {
    expect(post({ origin: ORIGIN })).toEqual({ ok: true });
    expect(post({ origin: "https://UNSET.CC" })).toEqual({ ok: true });
  });

  test.each([
    ["https://unset.cc.evil.example", "origin_mismatch"],
    ["https://evil.unset.cc", "origin_mismatch"],
    ["https://unset.sh", "origin_mismatch"],
    ["http://unset.cc", "origin_mismatch"],
    ["https://unset.cc:443", "origin_mismatch"],
    [`${ORIGIN}, ${ORIGIN}`, "origin_mismatch"],
    ["null", "origin_null"],
  ])("origin_exact denies %s", (origin, reason) => {
    expect(post({ origin })).toEqual(denied(reason));
  });

  test("origin_present_no_referer_fallback", () => {
    expect(post({ origin: "https://evil.example", referer: `${ORIGIN}/sign-in/return` })).toEqual(
      denied("origin_mismatch"),
    );
  });

  test("referer_exact", () => {
    expect(post({ referer: `${ORIGIN}/sign-in/return` })).toEqual({ ok: true });
    expect(post({ referer: "https://unset.cc.evil.example/" })).toEqual(denied("referer_mismatch"));
    expect(post({ referer: "not a url" })).toEqual(denied("referer_mismatch"));
  });

  test("get_and_head_pass, every other method is gated", () => {
    expect(gate(new Request(ORIGIN, { method: "GET" }))).toEqual({ ok: true });
    expect(gate(new Request(ORIGIN, { method: "HEAD" }))).toEqual({ ok: true });
    expect(gate(new Request(ORIGIN, { method: "DELETE" }))).toEqual(denied("no_signal"));
  });

  test("exception_denies", () => {
    const throwing = {
      method: "POST",
      headers: {
        get: () => {
          throw new Error("header getter failed");
        },
      },
    } as unknown as Request;
    expect(gate(throwing)).toEqual(denied("error"));
  });
});
