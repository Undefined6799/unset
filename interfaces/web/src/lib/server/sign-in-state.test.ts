// sign-in-state.ts (P1.20e, ported from interfaces/http's login and callback tests): the appState the callback reads
// back is input, so anything malformed is refused whole; the issuer a session records is a bare https DNS origin or
// nothing; cookies are read from the raw header, and a doubled one counts as none.
import { describe, expect, test } from "vitest";
import {
  appStateOf,
  cookieValue,
  issuerFromCookies,
  issuerOrigin,
  nonceFromCookies,
  parseAppState,
} from "./sign-in-state.ts";

const NONCE = "n".repeat(43);
const DID = `did:plc:${"a".repeat(24)}`;
const state = (fields: Record<string, unknown>) =>
  JSON.stringify({ v: 1, flow: "login", nonce: NONCE, expectedDid: null, next: null, silent: false, startedAt: 1, ...fields });

describe("the appState", () => {
  test("what_post_login_writes_reads_back_the_same", () => {
    const written = appStateOf({ nonce: NONCE, expectedDid: DID as never, next: "/settings" as never, silent: true });
    expect(parseAppState(written)).toEqual({ nonce: NONCE, expectedDid: DID, next: "/settings", silent: true });
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "1"],
    ["another version", state({ v: 2 })],
    ["another flow", state({ flow: "link" })],
    ["no start time", state({ startedAt: "1" })],
    ["a short nonce", state({ nonce: "n".repeat(42) })],
    ["a nonce with other characters", state({ nonce: `${"n".repeat(42)}=` })],
    ["a DID that does not parse", state({ expectedDid: "did:bad" })],
    ["a DID of the wrong type", state({ expectedDid: 7 })],
  ])("a_malformed_appstate_is_refused_whole: %s", (_name, text) => {
    expect(parseAppState(text)).toBeNull();
  });

  test("a_stored_next_is_checked_again_on_the_way_out", () => {
    expect(parseAppState(state({ next: "//evil.example/" }))?.next).toBeNull();
    expect(parseAppState(state({ next: "https://evil.example/" }))?.next).toBeNull();
    expect(parseAppState(state({ next: "/me" }))?.next).toBe("/me");
  });

  test("only_true_is_silent", () => {
    expect(parseAppState(state({ silent: "true" }))?.silent).toBe(false);
  });
});

describe("the recorded issuer", () => {
  test("a_bare_https_dns_origin_is_kept", () => {
    expect(issuerOrigin("https://pds.example")).toBe("https://pds.example");
    expect(issuerOrigin("https://pds.example/")).toBe("https://pds.example");
  });

  test.each([
    "http://pds.example",
    "https://pds.example:8443",
    "https://user:pass@pds.example",
    "https://127.0.0.1",
    "https://localhost",
    "https://pds.example.",
    "not a url",
  ])("anything_else_is_no_issuer: %s", (issuer) => {
    expect(issuerOrigin(issuer)).toBeNull();
  });
});

describe("cookies from the raw header", () => {
  test("a_doubled_cookie_counts_as_none", () => {
    expect(cookieValue(`a=1; a=2`, "a")).toBeNull();
    expect(nonceFromCookies(`__Host-oauth_nonce=${NONCE}; __Host-oauth_nonce=${NONCE}`)).toBeNull();
    expect(nonceFromCookies(`__Host-oauth_nonce=${NONCE}`)).toBe(NONCE);
  });

  test("an_issuer_cookie_that_is_not_a_bare_origin_is_dropped", () => {
    const carry = (value: string) => `__Host-signed_out_issuer=${Buffer.from(value).toString("base64url")}`;
    expect(issuerFromCookies(carry("https://pds.example"))).toBe("https://pds.example");
    expect(issuerFromCookies(carry("https://pds.example/account"))).toBeNull();
    expect(issuerFromCookies(carry("https://127.0.0.1"))).toBeNull();
  });
});
