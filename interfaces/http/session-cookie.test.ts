import { describe, expect, test } from "vitest";
import { SESSION_COOKIE, sessionClearCookie, sessionCookieValue, sessionSetCookie } from "./session-cookie.ts";

const VALUE = "A".repeat(43);

describe("session cookie", () => {
  test("session.cookie_attributes", () => {
    expect(SESSION_COOKIE).toBe("__Host-sid");
    expect(sessionSetCookie(VALUE, 2_592_000)).toBe(
      `__Host-sid=${VALUE}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );
    expect(sessionClearCookie()).toBe("__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    for (const header of [sessionSetCookie(VALUE, 60), sessionClearCookie()]) expect(header).not.toMatch(/domain/i);
  });

  test("session.cookie_max_age_is_whole_seconds", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sessionSetCookie(VALUE, bad), String(bad)).toThrow(RangeError);
    }
  });

  test("session.cookie_value_must_be_safe", () => {
    // A value the store did not issue never reaches a header: no separator, space or control character.
    for (const bad of ["", "a;b", "a b", "a\r\nSet-Cookie: x=1", "a,b", '"a"']) {
      expect(() => sessionSetCookie(bad, 60), JSON.stringify(bad)).toThrow(RangeError);
    }
  });

  test("session.cookie_read_one_value_only", () => {
    expect(sessionCookieValue(`__Host-sid=${VALUE}`)).toBe(VALUE);
    expect(sessionCookieValue(`a=1; __Host-sid=${VALUE}; b=2`)).toBe(VALUE);
    // Absent, or sent twice (a confused or planted jar): neither value is trusted.
    for (const header of [
      null,
      "",
      "a=1",
      "__Host-sidx=1",
      `sid=${VALUE}`,
      `__Host-sid=${VALUE}; __Host-sid=${VALUE}`,
    ]) {
      expect(sessionCookieValue(header), String(header)).toBeNull();
    }
    // The value is passed on as sent; the store refuses anything it did not issue.
    expect(sessionCookieValue("__Host-sid=")).toBe("");
  });
});
