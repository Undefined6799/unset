import { describe, expect, test } from "vitest";
import { AppError, ERROR_CODES, ERROR_MESSAGES, readErrorParam, withErrorParam } from "./index.ts";

const STATUSES = new Set([400, 401, 403, 404, 405, 409, 413, 415, 421, 429, 500, 503]);

describe("error catalog", () => {
  test("catalog_codes_well_formed", () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(code).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      expect(STATUSES.has(entry.status), code).toBe(true);
    }
  });

  test("every_public_code_has_english_text", () => {
    const publicCodes = Object.entries(ERROR_CODES)
      .filter(([, entry]) => entry.public)
      .map(([code]) => code);
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(publicCodes.sort());
  });

  test("error_param_roundtrip", () => {
    expect(withErrorParam("/login", "csrf.denied")).toBe("/login?error=csrf.denied");
    expect(withErrorParam("/login?next=1", "csrf.denied")).toBe("/login?next=1&error=csrf.denied");
    expect(readErrorParam("?error=csrf.denied")).toBe("csrf.denied");
    expect(readErrorParam(new URLSearchParams("error=http.not_found"))).toBe("http.not_found");
  });

  test("error_param_rejects_unknown", () => {
    for (const query of ["?error=foo", "?error=config.invalid", "?error=<script>", "?error=csrf.denied<script>", ""]) {
      expect(readErrorParam(query), query).toBeNull();
    }
    expect(readErrorParam("?error=__proto__")).toBeNull();
  });

  test("app_error_message_is_code", () => {
    const cause = new Error("upstream said something with user input");
    const error = new AppError("csrf.denied", { cause });
    expect(error.message).toBe("csrf.denied");
    expect(error.code).toBe("csrf.denied");
    expect(error.status).toBe(403);
    expect(error.cause).toBe(cause);
  });
});
