// P2.11a (app-gate.ts): where a stale email cache sends the browser once the PDS has answered. A dead grant signs the
// browser out at once, with the cookie cleared, on the same page respondToPdsFailure uses (pds-call.ts:232-234).
import { parseDid } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { expect, test } from "vitest";
import { type AppGate, openApp } from "./app-gate.ts";
import { sessionClearCookie } from "./session-cookie.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const did = parseDid(`did:plc:${"a".repeat(24)}`);
if (did === null) throw new Error("test DID did not parse");
const SESSION: Session = { did, idHash: Buffer.alloc(32, 1), createdAt: new Date(0), emailConfirmed: true };

function gateAnswering(answer: Awaited<ReturnType<AppGate["refreshEmail"]>>): AppGate {
  return {
    readSession: async () => ({ session: SESSION, clearCookie: false }),
    loadAccount: async () => ({ onboarding: "done", termsVersion: "t", privacyVersion: "p" }),
    versions: { terms: "t", privacy: "p" },
    // Older than the recheck, so the gate asks the PDS.
    emailCache: async () => ({ confirmed: true, checkedAt: new Date(NOW - 901_000) }),
    refreshEmail: async () => answer,
    now: () => NOW,
    emailRecheckS: 900,
  };
}

const open = (gate: AppGate) => openApp(gate, new Request("https://unset.test/me"), AbortSignal.timeout(1000), "/me");

test("app_gate.ended_grant_signs_out_with_the_cookie_cleared", async () => {
  const response = await open(gateAnswering("ended"));
  if (!(response instanceof Response)) throw new Error("the gate let an ended session through");
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login?error=login.session_ended");
  expect(response.headers.getSetCookie()).toEqual([sessionClearCookie()]);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("app_gate.unconfirmed_goes_to_verify_email_and_keeps_the_cookie", async () => {
  const response = await open(gateAnswering("unconfirmed"));
  if (!(response instanceof Response)) throw new Error("the gate let an unconfirmed email through");
  expect(response.headers.get("location")).toBe("/verify-email");
  expect(response.headers.getSetCookie()).toEqual([]);
});

test("app_gate.transient_keeps_the_cached_pass", async () => {
  expect(await open(gateAnswering("transient"))).toEqual({ session: SESSION, privacyNotice: false });
});
