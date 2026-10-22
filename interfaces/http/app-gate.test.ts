// P2.11a (app-gate.ts): where a stale email cache sends the browser once the PDS has answered. A dead grant signs the
// browser out at once, with the cookie cleared, on the same page respondToPdsFailure uses (pds-call.ts:232-234).
import * as web from "@unset/apps-web";
import { cachedRecheckCapS, parseDid } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { expect, test } from "vitest";
import { type AppGate, openApp, pdsUnavailablePage } from "./app-gate.ts";
import { sessionClearCookie } from "./session-cookie.ts";
import { pageResponse } from "./web/page.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const did = parseDid(`did:plc:${"a".repeat(24)}`);
if (did === null) throw new Error("test DID did not parse");
const SESSION: Session = { did, idHash: Buffer.alloc(32, 1), createdAt: new Date(0), emailConfirmed: true };

const NOTICE = "pds.test is not answering; your session is kept.";

function gateAnswering(answer: Awaited<ReturnType<AppGate["refreshEmail"]>>, ageMs = 901_000): AppGate {
  return {
    readSession: async () => ({ session: SESSION, clearCookie: false }),
    loadAccount: async () => ({ onboarding: "done", termsVersion: "t", privacyVersion: "p" }),
    versions: { terms: "t", privacy: "p" },
    // Older than the recheck, so the gate asks the PDS. The default age is still inside the cap.
    emailCache: async () => ({ confirmed: true, checkedAt: new Date(NOW - ageMs) }),
    refreshEmail: async () => answer,
    now: () => NOW,
    emailRecheckS: 900,
    unavailablePage: (request) =>
      pdsUnavailablePage(request, web.screens.verifyEmail({ state: "unavailable", pdsHost: "pds.test" }), (spec) =>
        pageResponse(
          {
            build: {
              manifest: {
                boot: "assets/boot.js",
                styles: [],
                fonts: [],
                icons: { favicon: "assets/icon.png", appleTouch: "assets/touch.png" },
                islands: new Map(),
              },
              files: new Map(),
            },
            render: web.renderPage,
            assetsOrigin: "https://unset.test",
            env: "test",
            log: createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined }),
          },
          spec,
        ),
      ),
  };
}

const pastCapMs = cachedRecheckCapS(900) * 1000 + 1;

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
  expect(await open(gateAnswering("confirmed", pastCapMs))).toEqual({ session: SESSION, privacyNotice: false });
});

test("app_gate.ended_grant_past_cap_still_signs_out", async () => {
  const response = await open(gateAnswering("ended", pastCapMs));
  if (!(response instanceof Response)) throw new Error("the gate let an ended session through");
  expect(response.headers.get("location")).toBe("/login?error=login.session_ended");
  expect(response.headers.getSetCookie()).toEqual([sessionClearCookie()]);
});
