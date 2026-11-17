// P2.11a (app-gate.ts): where a stale email cache sends the browser once the PDS has answered. A dead grant signs the
// browser out at once, with the cookie cleared, on the same page respondToPdsFailure uses (pds-call.ts:232-234).
import * as web from "@unset/apps-web";
import { cachedRecheckCapS, parseDid } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { expect, test } from "vitest";
import { type AppGate, appSessionGate, openApp, pdsUnavailablePage } from "./app-gate.ts";
import { sessionClearCookie } from "./session-cookie.ts";
import { testPage } from "./web/fixtures/page.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const did = parseDid(`did:plc:${"a".repeat(24)}`);
if (did === null) throw new Error("test DID did not parse");
const SESSION: Session = { did, idHash: Buffer.alloc(32, 1), createdAt: new Date(0), emailConfirmed: true };

const sessionCheckedAt = (ms: number): Session => ({ ...SESSION, emailCheckedAt: new Date(ms) });

const NOTICE = "pds.test is not answering; your session is kept.";

function gateAnswering(answer: Awaited<ReturnType<AppGate["refreshEmail"]>>, ageMs = 901_000): AppGate {
  return {
    // Older than the recheck, so the gate asks the PDS. The default age is still inside the cap.
    readSession: async () => ({ session: sessionCheckedAt(NOW - ageMs), clearCookie: false }),
    loadAccount: async () => ({ onboarding: "done", termsVersion: "t", privacyVersion: "p" }),
    versions: { terms: "t", privacy: "p" },
    refreshEmail: async () => answer,
    now: () => NOW,
    emailRecheckS: 900,
    unavailablePage: (request) =>
      pdsUnavailablePage(request, web.screens.verifyEmail({ state: "unavailable", pdsHost: "pds.test" }), testPage()),
  };
}

const pastCapMs = cachedRecheckCapS(900) * 1000 + 1;

const DEADLINE_AT = 54_321;
const open = (gate: AppGate) =>
  openApp(gate, new Request("https://unset.test/me"), AbortSignal.timeout(1000), "/me", DEADLINE_AT);

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
  expect(await open(gateAnswering("transient"))).toEqual({
    session: sessionCheckedAt(NOW - 901_000),
    privacyNotice: false,
  });
});

test("app_gate.transient_ages_past_the_cap_during_the_pds_call", async () => {
  // Inside the cap when the call starts, past it when the answer arrives. The PDS timeout is 10s.
  const gate = gateAnswering("transient", cachedRecheckCapS(900) * 1000 - 1_000);
  let reads = 0;
  gate.now = () => {
    reads += 1;
    return reads === 1 ? NOW : NOW + 2_000;
  };
  const response = await open(gate);
  if (!(response instanceof Response)) throw new Error("the gate served a cache that aged past the cap");
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(NOTICE);
  expect(response.headers.getSetCookie()).toEqual([]);
});

test("app_gate.transient_past_cap_shows_unavailable_and_keeps_the_cookie", async () => {
  const response = await open(gateAnswering("transient", pastCapMs));
  if (!(response instanceof Response)) throw new Error("the gate served a capped cache");
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(NOTICE);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("app_gate.confirmed_after_cap_restores_the_page", async () => {
  expect(await open(gateAnswering("confirmed", pastCapMs))).toEqual({
    session: sessionCheckedAt(NOW - pastCapMs),
    privacyNotice: false,
  });
});

test("app_gate.ended_grant_past_cap_still_signs_out", async () => {
  const response = await open(gateAnswering("ended", pastCapMs));
  if (!(response instanceof Response)) throw new Error("the gate let an ended session through");
  expect(response.headers.get("location")).toBe("/login?error=login.session_ended");
  expect(response.headers.getSetCookie()).toEqual([sessionClearCookie()]);
});

test("app_gate.refresh_gets_the_route_deadline", async () => {
  // P2.07a: the gate hands the route's deadlineAt to the refresh, never a budget of its own.
  const seen: number[] = [];
  const gate: AppGate = {
    ...gateAnswering("confirmed"),
    refreshEmail: async (_session, _deadline, deadlineAt) => {
      seen.push(deadlineAt);
      return "confirmed";
    },
  };
  await open(gate);
  expect(seen).toEqual([DEADLINE_AT]);
});

// P2.12f: the gate takes the cached answer from the session it was given, with no query of its own.
function gateCounting(session: Session) {
  let asked = 0;
  const gate: AppGate = {
    ...gateAnswering("unconfirmed"),
    readSession: async () => ({ session, clearCookie: false }),
    refreshEmail: async () => {
      asked += 1;
      return "confirmed";
    },
  };
  return { gate, asked: () => asked };
}

test("app_gate.fresh_check_on_the_session_passes_without_the_pds", async () => {
  const session = sessionCheckedAt(NOW - 899_000);
  const { gate, asked } = gateCounting(session);
  expect(await open(gate)).toEqual({ session, privacyNotice: false });
  expect(asked()).toBe(0);
});

test("app_gate.session_without_a_check_time_asks_the_pds", async () => {
  for (const session of [SESSION, { ...SESSION, emailCheckedAt: null }]) {
    const { gate, asked } = gateCounting(session);
    await open(gate);
    expect(asked()).toBe(1);
  }
});

test("app_gate.unconfirmed_session_goes_to_verify_email_without_the_pds", async () => {
  for (const emailConfirmed of [false, null]) {
    const { gate, asked } = gateCounting({ ...sessionCheckedAt(NOW), emailConfirmed });
    const response = await open(gate);
    if (!(response instanceof Response)) throw new Error("the gate let an unconfirmed email through");
    expect(response.headers.get("location")).toBe("/verify-email");
    expect(asked()).toBe(0);
  }
});

/** What the session gate asks `open` for on a route, or the error it throws. */
async function returnPath(method: string, route: string): Promise<string> {
  const asked: string[] = [];
  const gate = appSessionGate(async (_request, _deadline, next) => {
    asked.push(next);
    return new Response(null, { status: 303 });
  });
  const request = new Request(`https://unset.test/elsewhere?next=/evil`, { method });
  await gate({ request, route, params: {}, deadline: new AbortController().signal, deadlineAt: 0 });
  return asked.join();
}

test("session_gate.return_path_comes_from_the_route_template", async () => {
  // Never from the request: its path and query are /elsewhere?next=/evil throughout.
  expect(await returnPath("GET", "/settings/account")).toBe("/settings/account");
  expect(await returnPath("GET", "/did")).toBe("/did");
  expect(await returnPath("GET", "/me")).toBe("/did");
  expect(await returnPath("POST", "/profile")).toBe("/did");
  for (const route of ["/cards", "/cards/:key", "/cards/:key/delete", "/card-order"]) {
    expect(await returnPath("POST", route)).toBe("/did");
  }
  // The kit answers HEAD from the GET route (shared/http/server.ts), so a HEAD returns where its GET would.
  expect(await returnPath("HEAD", "/settings/account")).toBe("/settings/account");
  expect(await returnPath("HEAD", "/me")).toBe("/did");
});

test("session_gate.route_without_a_return_path_denies", async () => {
  // A POST path or a parameter template is no page to come back to; the kit answers a throwing gate as a denial.
  await expect(returnPath("POST", "/unlisted")).rejects.toThrow("no return path");
  await expect(returnPath("GET", "/:did")).rejects.toThrow("no return path");
  await expect(returnPath("GET", "/files/*")).rejects.toThrow("no return path");
  await expect(returnPath("HEAD", "/:did")).rejects.toThrow("no return path");
});

test("session_gate.admits_the_opened_session_under_its_did", async () => {
  const opened = { session: SESSION, privacyNotice: true };
  const { did } = SESSION;
  const gate = appSessionGate(async () => opened);
  const request = new Request("https://unset.test/did");
  const deadline = new AbortController().signal;
  expect(await gate({ request, route: "/did", params: {}, deadline, deadlineAt: 0 })).toEqual({ did, session: opened });
});
