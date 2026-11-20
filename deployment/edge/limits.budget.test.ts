// Normal use fits inside every app-facing edge zone (P1.21h; Alex 2026-11-19 13:21Z: the "normal use fits inside the
// limit" logic applies everywhere). Each zone gets the use a person really makes, which must pass, and a flood one past
// the zone, which must not. The numbers come from limits.json, so a changed zone is judged again here. No test changes
// a limit: a realistic use a zone refuses is written as `test.fails`, named, and reported for Alex's call.
//
// The zones are caddy-ratelimit's sliding window (5625512f24f6 ringbuffer.go:66-84): each key holds `events` slots of
// times; an event is allowed when the slot under the cursor is older than the window, and only an allowed event takes a
// slot. A request counts in every zone it matches (ratelimit.caddy's header comment).
//
// What a member's browser sends, as ratelimit.caddy's app comment counts it on the split SvelteKit build (P1.21g, ADR
// 0069): a page with a cold cache is its document, the two fonts and about 30 content-hashed build files under
// /_app/immutable/, which count in app_files and not in app_burst; a warm page or client navigation is 1 (its
// __data.json); and a first visit through sign-in, the welcome steps and /me is about 66 with no cache, every one of
// them counted in app_global. A sign-in is POST /login and the /oauth/callback redirect, plus POST /verify-email the
// first time; a sign-up is POST /join, the callback and POST /verify-email.
// ADR 0066's own app_burst test in edge.test.ts stays; this file judges every zone the same way.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

type Zone = { events: number; window: string };
const limits = JSON.parse(readFileSync(join(import.meta.dirname, "limits.json"), "utf8")) as {
  rateLimitZones: Record<string, Zone>;
  appRateLimitZones: Record<string, Zone>;
};

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

function zone(name: string): { events: number; windowMs: number } {
  const found = limits.appRateLimitZones[name] ?? limits.rateLimitZones[name];
  const parts = found?.window.match(/^(\d+)([smh])$/);
  if (found === undefined || parts === null || parts === undefined) throw new Error(`no zone ${name} in limits.json`);
  return { events: found.events, windowMs: Number(parts[1]) * (UNIT_MS[parts[2] ?? ""] ?? Number.NaN) };
}

/** Which of `times` (ms, in order, one client address) the zone allows. */
function allowed(name: string, times: readonly number[]): boolean[] {
  const { events, windowMs } = zone(name);
  const ring: number[] = Array(events).fill(Number.NEGATIVE_INFINITY);
  let cursor = 0;
  return times.map((at) => {
    if (at - (ring[cursor] ?? 0) <= windowMs) return false;
    ring[cursor] = at;
    cursor = (cursor + 1) % ring.length;
    return true;
  });
}

const refusedIn = (name: string, times: readonly number[]): number => allowed(name, times).filter((ok) => !ok).length;

/** `count` requests, one every `everyMs`, the first at `from`. */
const paced = (count: number, everyMs: number, from = 0): number[] =>
  Array.from({ length: count }, (_, i) => from + i * everyMs);

/** Several people behind one address (a household, an office, a phone carrier's shared address), merged in order. */
const together = (...people: readonly number[][]): number[] => people.flat().sort((a, b) => a - b);

/** What app_burst sees of a cold page: its document and the two fonts; the build files go to app_files. */
const COLD_PAGE = [0, 0, 0];
/** The build files of the heaviest cold page (27 scripts, the stylesheet and two icons; scripts/budgets/app-js.ts). */
const COLD_PAGE_FILES = 30;
const FIRST_VISIT = 66;

/** A flood one past the zone, all at once: everything up to the zone's size passes and the next is refused. */
function expectFloodRefused(name: string): void {
  const flood = allowed(name, Array(zone(name).events + 1).fill(0));
  expect(flood.slice(0, -1).every(Boolean)).toBe(true);
  expect(flood.at(-1)).toBe(false);
}

describe("app_burst", () => {
  test("a_cold_page_then_four_clicks_a_second_for_ten_seconds_passes", () => {
    // The P1.20o white page: Settings and Profile pressed fast (Alex 2026-11-19 13:01Z).
    expect(refusedIn("app_burst", [...COLD_PAGE, ...paced(40, 250, 250)])).toBe(0);
  });

  test("three_people_behind_one_address_clicking_once_a_second_pass", () => {
    const person = (offset: number) => paced(60, 1000, offset);
    expect(refusedIn("app_burst", together(person(0), person(330), person(660)))).toBe(0);
  });

  test("a_flood_one_past_the_zone_is_refused", () => expectFloodRefused("app_burst"));
});

describe("app_files", () => {
  test("two_people_behind_one_address_opening_a_cold_page_at_once_then_browsing_pass", () => {
    const person = (offset: number) => [...Array(COLD_PAGE_FILES).fill(offset), ...paced(10, 100, offset + 1_000)];
    expect(refusedIn("app_files", together(person(0), person(0)))).toBe(0);
  });

  test("a_flood_one_past_the_zone_is_refused", () => expectFloodRefused("app_files"));
});

describe("app_global", () => {
  test("a_first_visit_then_five_minutes_of_a_click_every_two_seconds_passes", () => {
    const firstVisit = paced(FIRST_VISIT, 300);
    expect(refusedIn("app_global", [...firstVisit, ...paced(150, 2000, 10_000)])).toBe(0);
  });

  test("five_people_behind_one_address_each_on_a_first_visit_and_browsing_pass", () => {
    const person = (offset: number) => [...paced(FIRST_VISIT, 300, offset), ...paced(150, 2000, offset + 10_000)];
    expect(refusedIn("app_global", together(...[0, 100, 200, 300, 400].map(person)))).toBe(0);
  });

  test("a_flood_one_past_the_zone_is_refused", () => expectFloodRefused("app_global"));
});

describe("app_signin", () => {
  const signInFirstTime = (at: number) => [at, at + 3_000, at + 20_000]; // POST /login, the callback, POST /verify-email
  const signIn = (at: number) => [at, at + 3_000];

  test("a_first_sign_in_with_its_email_check_passes", () => {
    expect(refusedIn("app_signin", signInFirstTime(0))).toBe(0);
  });

  test("a_sign_up_passes", () => {
    expect(refusedIn("app_signin", [0, 30_000, 60_000])).toBe(0); // POST /join, the callback, POST /verify-email
  });

  test("signing_out_and_back_in_once_within_five_minutes_passes", () => {
    expect(refusedIn("app_signin", [...signInFirstTime(0), ...signIn(60_000)])).toBe(0);
  });

  // Expected to fail, reported for Alex's call: two people behind one address (a household, or a phone carrier's shared
  // address) each signing in for the first time within five minutes make six counted requests, one past the zone. The
  // fix on the table is his line "Count only the login post in the edge sign-in limit." (not typed as of 2026-11-19).
  test.fails("two_people_behind_one_address_signing_in_for_the_first_time_pass", () => {
    expect(refusedIn("app_signin", together(signInFirstTime(0), signInFirstTime(45_000)))).toBe(0);
  });

  test("a_flood_one_past_the_zone_is_refused", () => expectFloodRefused("app_signin"));
});

// The PDS zones a member's own browser reaches while signing in or up at our PDS (@atproto/oauth-provider's pages;
// ratelimit.caddy's matchers). One attempt is one POST to the zone's path.
describe("pds sign-in pages", () => {
  test("three_people_behind_one_address_each_mistyping_a_password_four_times_pass", () => {
    const person = (offset: number) => paced(5, 15_000, offset); // four wrong, one right
    expect(refusedIn("oauth_signin", together(person(0), person(5_000), person(10_000)))).toBe(0);
  });

  test("three_people_behind_one_address_signing_up_pass", () => {
    expect(refusedIn("signup", paced(3, 120_000))).toBe(0);
  });

  test("a_member_who_asks_for_a_reset_email_three_times_then_resets_passes", () => {
    expect(refusedIn("reset", [0, 120_000, 600_000, 900_000])).toBe(0);
  });

  test.each(["oauth_signin", "signup", "reset"])("a_flood_one_past_%s_is_refused", (name) => expectFloodRefused(name));
});

// Web's own calls to our PDS, which every member shares. On staging web reaches the PDS by its public name through
// Pangolin, Newt and this edge (compose.dev.yaml's net-guard comment; ADR 0031 Decision 3), and the dev listener keys
// zones by Newt's X-Forwarded-For (the Caddyfile), so every member's calls count under web's one address. Each test
// states the zone's size in members, for Alex's call on these zones before production.
//
// What web sends per action (infrastructure/pds): a member's own profile page is getRecord for the profile and two
// listRecords pages for the cards, since the PDS returns a cursor whenever a page holds a record (atproto main,
// packages/pds/src/api/com/atproto/repo/listRecords.ts, read 2026-11-20; the 0.4.5051 image's copy not checked); saving
// a card is getRecord and putRecord, then the page loads again; adding one reads the repo head
// (com.atproto.sync.getLatestCommit) before createRecord. A sign-in is the pushed request, the token exchange and
// getSession; a signed-in member's access token lasts 60 minutes (@atproto/oauth-provider oauth-constants.ts
// TOKEN_MAX_AGE, main), so web refreshes it about once an hour. A DPoP nonce retry would add a call and is not counted.
// Not here: web uploads no blob yet (blob_upload), never calls createSession (session), and the indexer and pds-admin
// reach the PDS inside the stack, not through this edge (sync's firehose and blob_read zones).
describe("web's own calls to our pds", () => {
  const view = (at: number) => [at, at, at + 100];
  const save = (at: number) => [at, at + 100, ...view(at + 300)];
  const add = (at: number) => [at, at + 100, at + 100, at + 200, ...view(at + 300)];
  const minutes = (count: number, everyMs: number, action: (at: number) => number[], from: number) =>
    Array.from({ length: Math.round((count * 60_000) / everyMs) }, (_, k) => action(from + k * everyMs)).flat();
  /** `count` members, their starts spread evenly over `spreadMs`, merged in order. */
  const members = (count: number, spreadMs: number, member: (from: number) => number[]) =>
    together(...Array.from({ length: count }, (_, n) => member((n * spreadMs) / count)));
  const viewing = (from: number) => minutes(10, 60_000, view, from); // their own profile once a minute
  const editing = (from: number) => [...view(from), ...minutes(10, 15_000, save, from + 5_000)]; // a save every 15 s

  test("a_hundred_members_each_viewing_their_profile_once_a_minute_pass", () => {
    expect(refusedIn("global", members(100, 60_000, viewing))).toBe(0);
  });

  test("twenty_five_members_each_saving_a_card_every_fifteen_seconds_pass", () => {
    expect(refusedIn("global", members(25, 15_000, editing))).toBe(0);
  });

  // Expected to fail, reported for Alex's call: about 29 members editing at once fill `global` (3000 in 5 minutes),
  // and the next PDS call any member makes is refused, so pages fail for everyone until the window moves on.
  test.fails("a_hundred_members_each_saving_a_card_every_fifteen_seconds_pass", () => {
    expect(refusedIn("global", members(100, 15_000, editing))).toBe(0);
  });

  test("a_hundred_members_each_adding_ten_cards_in_five_minutes_pass_the_repo_head_reads", () => {
    const adding = (from: number) => paced(10, 30_000, from);
    expect(refusedIn("sync", members(100, 30_000, adding))).toBe(0);
    expect(
      refusedIn(
        "global",
        members(20, 30_000, (from) => minutes(5, 30_000, add, from)),
      ),
    ).toBe(0);
  });

  /** Token exchanges in five minutes: `signIns` members signing in, and `active` signed-in members refreshing hourly. */
  const tokenUse = (signIns: number, active: number) =>
    together(
      paced(signIns, 300_000 / signIns),
      paced(active, 3_600_000 / active).filter((at) => at < 300_000),
    );

  test("sixty_sign_ins_in_five_minutes_while_seven_hundred_members_stay_active_pass", () => {
    expect(refusedIn("oauth_token", tokenUse(60, 700))).toBe(0);
  });

  // Expected to fail, reported for Alex's call: the token zone is shared by sign-ins and hourly refreshes, so a hundred
  // sign-ins in five minutes leave room for only about 240 other active members (100 + 1000 / 12 > 120 here).
  test.fails("a_hundred_sign_ins_in_five_minutes_while_a_thousand_members_stay_active_pass", () => {
    expect(refusedIn("oauth_token", tokenUse(100, 1000))).toBe(0);
  });

  // Not a failure, a size: web's own sign-in ceiling lets about 700 sign-ins through in five minutes (120 at once, then
  // 2 a second), but the PDS token exchange takes 120 in five minutes from web's one address, so the 121st member is
  // refused after typing their password.
  test("the_hundred_and_twenty_first_token_exchange_in_five_minutes_is_refused", () => {
    expect(refusedIn("oauth_token", paced(121, 2_000))).toBe(1);
  });
});
