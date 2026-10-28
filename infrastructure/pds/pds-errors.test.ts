// P2.07 (pds-errors.ts): the pure classifiers, including the book’s case tables.

import { OAuthResponseError, TokenRefreshError } from "@atproto/oauth-client-node";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import { describe, expect, test } from "vitest";
import { isDpopNonceHandshake, restoreOutcome } from "./pds-errors.ts";

const http = (status: number, error?: string, headers?: Headers | Record<string, string>) =>
  Object.assign(new Error("http"), { status, ...(error === undefined ? {} : { error }), headers });

describe("isDpopNonceHandshake", () => {
  test("isDpopNonceHandshake.cases", () => {
    expect(isDpopNonceHandshake({ error: "use_dpop_nonce" })).toBe(true);
    expect(isDpopNonceHandshake(http(401, "use_dpop_nonce"))).toBe(true);
    const headers = new Headers();
    headers.set("www-authenticate", 'DPoP error="use_dpop_nonce"');
    expect(isDpopNonceHandshake(http(401, undefined, headers))).toBe(true);
    expect(isDpopNonceHandshake(http(401, undefined, { "WWW-Authenticate": 'error="use_dpop_nonce"' }))).toBe(true);
    expect(isDpopNonceHandshake(http(401, "InvalidToken"))).toBe(false);
  });
});

describe("restoreOutcome", () => {
  test("restore_classes", () => {
    const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    expect(restoreOutcome(new TokenRefreshError(did, "The session was revoked"))).toBe("auth_dead");
    expect(restoreOutcome(new TypeError("Issuer mismatch"))).toBe("auth_dead");
    const unsatisfiable = new Error("gone");
    unsatisfiable.name = "AuthMethodUnsatisfiableError";
    expect(restoreOutcome(unsatisfiable)).toBe("auth_dead");
    const lock = new Error("lock");
    lock.name = "LockError";
    Object.assign(lock, { code: "lock.timeout" });
    expect(restoreOutcome(lock)).toBe("lock_timeout");
    expect(restoreOutcome(new NetGuardError("egress.connect"))).toBe("unavailable");
    expect(restoreOutcome(new OAuthResponseError(new Response(null, { status: 503 }), {}))).toBe("unavailable");
    expect(restoreOutcome(new TypeError("something else"))).toBe("unexpected");
  });
});
