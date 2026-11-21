// Normal use fits inside the web process's own limits (P1.21h; Alex 2026-11-19 13:21Z: the "normal use fits inside the
// limit" logic applies everywhere). The real limiter (shared/http createRateLimiter) runs this file's table on a fake
// clock, called as hooks.server.ts calls it: every request once by address under its route's policy (a POST under the
// route's writeLimit when it has one), and a signed-in request to a page that needs a session once more by the
// member's DID. Each policy gets the use a person really makes, which must pass, and a flood, which must not. No test
// changes a limit; a realistic use refused here would be written as `test.fails` and reported.
//
// Staging and production run in socket mode (deployment/compose.dev.yaml TRUSTED_PROXY_MODE: socket; ADR 0042): the
// edge holds each address to its zones, and here only the site-wide and per-member buckets stay.
import { createClientIpResolver, createRateLimiter, type PolicyName } from "@unset/shared-http";
import { describe, expect, test } from "vitest";
import { policiesFor } from "./limits.ts";

type Request = { at: number; policy: PolicyName; address: string; did?: string };

/** How many of `requests` (in time order) the web process refuses in `mode`. */
function refused(mode: "header" | "socket", requests: readonly Request[]): number {
  let clock = 0;
  const limiter = createRateLimiter(policiesFor(mode), {
    maxKeys: 100_000,
    onError: () => undefined,
    now: () => clock,
  });
  const clientIp = createClientIpResolver(
    {
      TRUSTED_PROXY_MODE: "socket",
      TRUSTED_PROXY_HEADER: "x-forwarded-for",
      TRUSTED_PROXY_CIDRS: [],
      TRUSTED_PROXY_HOPS: 1,
    },
    () => undefined,
  );
  let count = 0;
  for (const request of [...requests].sort((a, b) => a.at - b.at)) {
    clock = request.at;
    const ip = clientIp(new Headers(), request.address);
    const byIp = limiter.consume(request.policy, { ip });
    const byDid = byIp.ok && request.did !== undefined ? limiter.consume(request.policy, { did: request.did }) : byIp;
    if (!byIp.ok || !byDid.ok) count += 1;
  }
  return count;
}

/** In socket mode every request reaches web from the edge's one address. */
const EDGE = "10.0.0.2";
const member = (n: number) => `did:plc:member${String(n).padStart(4, "0")}`;
const address = (n: number) => `198.51.100.${(n % 250) + 1}`;

/** `count` requests by one member, one every `everyMs`, the first at `from`. */
const paced = (count: number, everyMs: number, make: (at: number) => Request, from = 0): Request[] =>
  Array.from({ length: count }, (_, i) => make(from + i * everyMs));

describe("one member", () => {
  const save = (at: number): Request => ({ at, policy: "profile", address: EDGE, did: member(1) });

  test("saving_the_profile_three_times_fast_then_arranging_twenty_cards_in_a_minute_passes", () => {
    expect(refused("socket", [...paced(3, 100, save), ...paced(20, 3000, save, 1000)])).toBe(0);
  });

  test("thirty_one_card_writes_at_once_are_refused_once", () => {
    expect(refused("socket", paced(31, 0, save))).toBe(1);
  });

  test("asking_for_an_invite_three_times_in_an_hour_passes_and_an_eleventh_at_once_is_refused", () => {
    const ask = (at: number): Request => ({ at, policy: "invite", address: EDGE, did: member(1) });
    expect(refused("socket", paced(3, 600_000, ask))).toBe(0);
    expect(refused("socket", paced(11, 0, ask))).toBe(1);
  });

  test("an_impatient_member_pressing_mark_all_as_read_ten_times_in_two_seconds_and_opening_fifty_passes", () => {
    // P2.27: each press and each opened row is one POST under `notifications`; repeats change nothing more.
    const press = (at: number): Request => ({ at, policy: "notifications", address: EDGE, did: member(1) });
    expect(refused("socket", [...paced(10, 200, press), ...paced(50, 1000, press, 2000)])).toBe(0);
    expect(refused("header", [...paced(10, 200, press), ...paced(50, 1000, press, 2000)])).toBe(0);
  });

  test("a_hundred_and_twenty_one_notification_posts_at_once_are_refused_once", () => {
    const press = (at: number): Request => ({ at, policy: "notifications", address: EDGE, did: member(1) });
    expect(refused("socket", paced(121, 0, press))).toBe(1);
  });

  test("clicking_four_times_a_second_for_a_minute_passes_with_addresses_seen", () => {
    // Local and test stacks run in header mode, where the per-address bucket holds (60 at once, 5 a second).
    const click = (at: number): Request => ({ at, policy: "default", address: address(1) });
    expect(refused("header", paced(240, 250, click))).toBe(0);
    expect(refused("header", paced(61, 0, click))).toBe(1);
  });
});

describe("the whole site behind the edge", () => {
  // The site-wide default bucket (ADR 0042), shared by every member: 30000 at once, 500 a second since P1.21j
  // (Proposed ADR 0071; it was 3000 and 50, which held about 100 such members). These tests state its size in members.
  const browsing = (members: number, seconds: number): Request[] =>
    Array.from({ length: members }, (_, n) =>
      paced(seconds / 2, 2000, (at) => ({ at, policy: "default", address: EDGE }), (n * 2000) / members),
    ).flat();

  test("a_thousand_members_each_clicking_every_two_seconds_for_five_minutes_pass", () => {
    expect(refused("socket", browsing(1000, 300))).toBe(0);
  });

  test("two_thousand_members_each_clicking_every_two_seconds_are_refused_within_two_minutes", () => {
    expect(refused("socket", browsing(2000, 120))).toBeGreaterThan(0);
  });

  test("three_hundred_members_signing_in_within_one_minute_pass", () => {
    // POST /login and the callback both count under `login`; in socket mode that is the site-wide sign-in ceiling,
    // 600 at once and 10 a second since P1.21j (it was 120 and 2).
    const signIns = Array.from({ length: 300 }, (_, n) => [
      { at: n * 200, policy: "login", address: EDGE },
      { at: n * 200 + 3000, policy: "login", address: EDGE },
    ]).flat();
    expect(refused("socket", signIns)).toBe(0);
  });

  test("a_sign_in_flood_past_the_ceiling_is_refused", () => {
    expect(
      refused(
        "socket",
        paced(601, 0, (at) => ({ at, policy: "login", address: EDGE })),
      ),
    ).toBe(1);
  });

  test("a_page_flood_past_the_ceiling_is_refused", () => {
    expect(
      refused(
        "socket",
        paced(30_001, 0, (at) => ({ at, policy: "default", address: EDGE })),
      ),
    ).toBe(1);
  });
});

describe("invite requests (P2.10r; ADR 0080)", () => {
  const ask = (at: number, n = 1): Request => ({ at, policy: "inviteRequest", address: address(n) });
  const HOUR = 3_600_000;

  test("a_visitor_who_mistypes_twice_then_sends_passes", () => {
    expect(
      refused(
        "header",
        paced(3, 20_000, (at) => ask(at)),
      ),
    ).toBe(0);
  });

  test("a_fourth_request_from_one_address_within_the_hour_is_refused", () => {
    expect(
      refused(
        "header",
        paced(4, 1000, (at) => ask(at)),
      ),
    ).toBe(1);
  });

  test("twenty_visitors_over_a_day_pass_and_a_twenty_first_at_once_is_refused", () => {
    // Behind the edge only the site-wide bucket stays: 20 at once, refilled at 20 a day.
    const viaEdge = (at: number): Request => ({ ...ask(at), address: EDGE });
    expect(refused("socket", paced(20, HOUR, viaEdge))).toBe(0);
    expect(refused("socket", paced(21, 1000, viaEdge))).toBe(1);
  });
});
