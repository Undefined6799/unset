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
  docsRateLimitZones: Record<string, Zone>;
};

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

function zone(name: string): { events: number; windowMs: number } {
  const found = limits.appRateLimitZones[name] ?? limits.rateLimitZones[name] ?? limits.docsRateLimitZones[name];
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
/** The build files of a cold public profile as a signed-out visitor's browser asks for them (P1.22f, measured). */
const COLD_PUBLIC_PAGE_FILES = 32;
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

  // Signed-out visitors behind one address (an office, a school, a phone carrier's shared address) opening a link to a
  // public page that runs the client (book P1.22f; ADR 0114, ADR 0116). Measured in Chromium through edge.caddy at
  // 60228f5: a cold /@handle asks for 32 build files (30 scripts, the stylesheet, the favicon) within half a second,
  // and so would home (28) and the unmatched page (26) once they run the client; a warm one asks for none
  // (docs/ai/notes/reference/visitors-behind-one-address.md). Three such visitors fit in any 10 s.
  const visitors = (count: number, everyMs: number) =>
    together(...Array.from({ length: count }, (_, n) => Array(COLD_PUBLIC_PAGE_FILES).fill(n * everyMs) as number[]));

  test("three_visitors_behind_one_address_opening_a_cold_public_page_at_once_pass", () => {
    expect(refusedIn("app_files", visitors(3, 0))).toBe(0);
  });

  // Reported for Alex's call, not changed here (book P1.22f; ADR 0059): a fourth visitor in the same 10 s loses some
  // of the files. The server's page still reads whole (tests/e2e/refused-file.spec.ts), without the client and
  // sometimes without its stylesheet. Measured: 4 at once, 2 of 4 got the client; 10 arriving one a second, 3 did.
  test.fails("four_visitors_behind_one_address_opening_a_cold_public_page_within_ten_seconds_pass", () => {
    expect(refusedIn("app_files", visitors(4, 2_000))).toBe(0);
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

  test("thirty_visitors_behind_one_address_each_opening_a_cold_public_page_in_five_minutes_pass", () => {
    // P1.22f: a cold public page is its document, two fonts and 32 build files, all counted here; the 35th such
    // visitor in five minutes meets app_global (1200) whatever app_files allows.
    const visitor = (at: number) => Array(COLD_PUBLIC_PAGE_FILES + 3).fill(at) as number[];
    expect(refusedIn("app_global", together(...paced(30, 10_000).map(visitor)))).toBe(0);
  });

  test("a_flood_one_past_the_zone_is_refused", () => expectFloodRefused("app_global"));
});

describe("app_signin", () => {
  // Since P1.21j (Proposed ADR 0071) the zone counts POST /login and POST /join only: one per sign-in or sign-up. The
  // callback and POST /verify-email still count in app_burst and app_global.
  test("a_first_sign_in_and_a_sign_up_pass", () => {
    expect(refusedIn("app_signin", [0, 60_000])).toBe(0);
  });

  test("signing_out_and_back_in_three_times_within_five_minutes_passes", () => {
    expect(refusedIn("app_signin", paced(4, 60_000))).toBe(0);
  });

  test("five_people_behind_one_address_each_signing_in_twice_within_five_minutes_pass", () => {
    // A household or a phone carrier's shared address; before P1.21j two first sign-ins went over.
    const person = (offset: number) => [offset, offset + 120_000];
    expect(refusedIn("app_signin", together(...[0, 10_000, 20_000, 30_000, 40_000].map(person)))).toBe(0);
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

// Web's own calls to our PDS. On staging web reaches the PDS by its public name through Pangolin, Newt and this edge
// (compose.dev.yaml's net-guard comment; ADR 0031 Decision 3), so every member's calls arrive from web's one address.
// Since P1.21j (Proposed ADR 0071) web marks them with its key, and the edge counts a marked call in web_global and
// web_oauth_token instead of global and oauth_token (ratelimit.caddy); an unmarked or wrongly marked call stays in the
// tight zones, as an outside client's does.
//
// What web sends per action (infrastructure/pds): a member's own profile page is getRecord for the profile and two
// listRecords pages for the cards, since the PDS returns a cursor whenever a page holds a record (atproto main,
// packages/pds/src/api/com/atproto/repo/listRecords.ts, read 2026-11-20; the 0.4.5051 image's copy not checked); saving
// a card is getRecord and putRecord, then the page loads again; adding one reads the repo head
// (com.atproto.sync.getLatestCommit) before createRecord. A sign-in is the pushed request, the token exchange and
// getSession; a signed-in member's access token lasts 60 minutes (@atproto/oauth-provider oauth-constants.ts
// TOKEN_MAX_AGE, main), so web refreshes it about once an hour. A DPoP nonce retry would add a call and is not counted.
// Not here: web uploads no blob yet (blob_upload, ADR 0070), never calls createSession (session), and the indexer and
// pds-admin reach the PDS inside the stack, not through this edge (sync's firehose and blob_read zones).
//
// The marked zones are sized from web's own ceilings (interfaces/web/src/lib/server/limits.ts): pages at 500 a second
// with up to 3 PDS calls each is 1500 calls a second, web_global's 90000 a minute; sign-ins at 10 a second are 5 token
// exchanges a second, and web_oauth_token's 3000 in 5 minutes is 10 a second. A web that is broken or taken over still
// meets these.
describe("web's own calls to our pds", () => {
  const view = (at: number) => [at, at, at + 100];
  const save = (at: number) => [at, at + 100, ...view(at + 300)];
  const minutes = (count: number, everyMs: number, action: (at: number) => number[], from: number) =>
    Array.from({ length: Math.round((count * 60_000) / everyMs) }, (_, k) => action(from + k * everyMs)).flat();
  /** `count` members, their starts spread evenly over `spreadMs`, merged in order. */
  const members = (count: number, spreadMs: number, member: (from: number) => number[]) =>
    together(...Array.from({ length: count }, (_, n) => member((n * spreadMs) / count)));
  const editing = (from: number) => [...view(from), ...minutes(3, 15_000, save, from + 5_000)]; // a save every 15 s

  test("four_thousand_members_each_saving_a_card_every_fifteen_seconds_pass", () => {
    // Before P1.21j about 29 fitted, in global (3000 in 5 minutes).
    expect(refusedIn("web_global", members(4000, 15_000, editing))).toBe(0);
  });

  /** Token exchanges in five minutes: `signIns` members signing in, and `active` signed-in members refreshing hourly. */
  const tokenUse = (signIns: number, active: number) =>
    together(
      paced(signIns, 300_000 / signIns),
      paced(active, 3_600_000 / active).filter((at) => at < 300_000),
    );

  test("a_thousand_sign_ins_in_five_minutes_while_twenty_thousand_members_stay_active_pass", () => {
    // Before P1.21j a hundred sign-ins left room for about 240 other active members, in oauth_token (120 in 5 minutes).
    expect(refusedIn("web_oauth_token", tokenUse(1000, 20_000))).toBe(0);
  });

  test.each(["global", "oauth_token", "web_global", "web_oauth_token"])("a_flood_one_past_%s_is_refused", (name) =>
    expectFloodRefused(name),
  );
});

// The docs site (P1.21w; ADR 0075): one zone, docs_global, for every request. A docs page with no cache is at most 12
// requests (the page, the stylesheet, five scripts, the icons, the manifest and the search index; Hextra v0.13.0 as
// built at P1.21w), and nothing is counted as cached, since the edge sets no cache lifetime and a browser revalidates.
describe("docs_global", () => {
  const DOCS_PAGE = 12;
  /** One reader opening `pages` pages, one every `everyMs`, each page's requests at once. */
  const reader = (pages: number, everyMs: number, from = 0) =>
    paced(pages, everyMs, from).flatMap((at) => Array(DOCS_PAGE).fill(at) as number[]);

  test("a_reader_opening_a_page_a_second_for_five_minutes_passes", () => {
    expect(refusedIn("docs_global", reader(300, 1000))).toBe(0);
  });

  test("twenty_readers_behind_one_address_each_reading_twenty_pages_in_five_minutes_pass", () => {
    const office = Array.from({ length: 20 }, (_, n) => reader(20, 15_000, n * 500));
    expect(refusedIn("docs_global", together(...office))).toBe(0);
  });

  test("a_flood_one_past_docs_global_is_refused", () => expectFloodRefused("docs_global"));
});
