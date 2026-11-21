// P3.12s: the public profile at /@<handle> and /@<DID> on the built web server, read from the index as `web` through
// the views of migration 0030 (TE-2). The index is written as `indexer`, the role that writes it in production. No
// network: the page never reads a PDS. Decision 35 D7 and rule SE-2: every account the page may not show, and every
// path that is no actor, gets one 404 with the same bytes and headers. ADR 0078 (P1.22a): a page shown to signed-in
// members only, or only to its member, gives anyone it leaves out the limited page, never the 404, and is never offered
// to search engines; the session is read when a cookie is sent.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { CARDS_MAX, toCardRecord } from "@unset/domains-profile";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const indexer = createPool({
  connection: { host: provided.host, port: provided.port, database, ...provided.roles.indexer, ssl: false },
  service: "web-public-profile-test",
  max: 2,
  connectTimeoutMs: 5000,
});

const webPool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-public-profile-session-test",
  max: 2,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool: webPool, sealer: createSealer(keyring), log: quiet });

/** A signed-in browser for `owner`, as gate.test.ts makes one: a stored grant, then a session; returns the cookie. */
async function signedIn(owner: string): Promise<string> {
  const ownerDid = parseDid(owner) as Did;
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  const issuer = "https://pds.unset.test";
  await tokenSets.set(ownerDid, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: issuer,
      sub: owner as SavedSession["tokenSet"]["sub"],
      aud: issuer,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(webPool, null, (tx) => sessions.create(tx, ownerDid));
  return `__Host-sid=${created.cookieValue}`;
}

const NOW = "2026-11-19T00:00:00.000Z";
const SHOWN = `did:plc:${"p".repeat(24)}`;
const NAMED = `did:plc:${"q".repeat(24)}`;
const HIDDEN = `did:plc:${"r".repeat(24)}`;
const BARE = `did:plc:${"s".repeat(24)}`;
const UNVERIFIED = `did:plc:${"t".repeat(24)}`;
const MANY = `did:plc:${"u".repeat(24)}`;
const MEMBERS = `did:plc:${"v".repeat(24)}`;
const ONLY_ME = `did:plc:${"w".repeat(24)}`;
const FUTURE = `did:plc:${"x".repeat(24)}`;
const OTHER = `did:plc:${"y".repeat(24)}`;

/** An account as the indexer leaves it once our PDS confirmed it, with a profile and one README card unless told. */
async function indexed(
  did: string,
  opts: {
    handle?: string;
    status?: string;
    active?: boolean;
    name?: string;
    profile?: boolean;
    surface?: "plain";
    visibility?: string;
  } = {},
) {
  const { handle = null, status = "unresolved", active = true, name = "Member", profile = true } = opts;
  const card = toCardRecord({ kind: "readme", text: `Card of ${name}` }, "full", null, NOW, opts.surface);
  if (!card.ok) throw new Error(`seed card did not build: ${card.code}`);
  const record = {
    $type: "sh.unset.profile",
    displayName: name,
    headline: "<b>Head</b>",
    createdAt: NOW,
    // The profile lists its card, so it shows (ADR 0086 point 3).
    cards: [{ uri: `at://${did}/sh.unset.card/3jzfcijpj2z2a` }],
    ...(opts.visibility === undefined ? {} : { visibility: opts.visibility }),
  };
  await withClient(indexer, null, async (c) => {
    await c.query("INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())", [did]);
    await c.query("UPDATE idx.account SET handle = $2, handle_status = $3, pds_active = $4 WHERE did = $1", [
      did,
      handle,
      status,
      active,
    ]);
    if (profile)
      await c.query(
        `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
         VALUES ($1, $2, 'cid-p', '3l', $3, $4, false, now())`,
        [did, `at://${did}/sh.unset.profile/self`, record, name],
      );
    await c.query(
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
       VALUES ($1, $2, '3jzfcijpj2z2a', 'cid-s', '3l', $3, 0, now())`,
      [`at://${did}/sh.unset.card/3jzfcijpj2z2a`, did, card.record],
    );
  });
}

/**
 * `count` more README cards for `did`, keys after the first card's, each saying "Extra card", listed after it by the
 * profile as the indexer stores a list (each card's position is its place in the list).
 */
async function moreCards(did: string, count: number) {
  const card = toCardRecord({ kind: "readme", text: "Extra card" }, "full", null, NOW);
  if (!card.ok) throw new Error(`seed card did not build: ${card.code}`);
  const rkeys = Array.from({ length: count }, (_, i) => `extra${String(i).padStart(3, "0")}`);
  await withClient(indexer, null, async (c) => {
    for (const [i, rkey] of rkeys.entries()) {
      await c.query(
        `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
         VALUES ($1, $2, $3, 'cid-s', '3l', $4, $5, now())`,
        [`at://${did}/sh.unset.card/${rkey}`, did, rkey, card.record, i + 1],
      );
    }
    const extra = rkeys.map((rkey) => ({ uri: `at://${did}/sh.unset.card/${rkey}` }));
    await c.query(
      `UPDATE idx.profile SET record = jsonb_set(record, '{cards}', (record -> 'cards') || $2::jsonb) WHERE did = $1`,
      [did, JSON.stringify(extra)],
    );
  });
}

let web: RunningWeb;
/** A server with invite requests on (ADR 0080), so the limited card offers Sign up. It never sends a mail here. */
let inviting: RunningWeb;
let secrets: string;
beforeAll(async () => {
  buildOnce(provided.port);
  await indexed(SHOWN, { name: "Shown Member" });
  await indexed(NAMED, { handle: "alice.unset.org", status: "verified", name: "Alice", surface: "plain" });
  await indexed(HIDDEN, { active: false, name: "Hidden Member" });
  await indexed(BARE, { profile: false, name: "Bare Member" });
  await indexed(UNVERIFIED, { handle: "mallory.unset.org", status: "invalid", name: "Mallory" });
  await indexed(MANY, { name: "Many" });
  await moreCards(MANY, CARDS_MAX);
  await indexed(MEMBERS, { handle: "bea.unset.org", status: "verified", name: "Bea", visibility: "signed-in" });
  await indexed(ONLY_ME, { handle: "cy.unset.org", status: "verified", name: "Cy", visibility: "owner-only" });
  await indexed(FUTURE, { name: "Future", visibility: "friendsOfFriends" });
  secrets = mkdtempSync(join(tmpdir(), "public-profile-"));
  const file = (name: string, text: string): string => {
    const path = join(secrets, name);
    writeFileSync(path, text, { mode: 0o600 });
    return path;
  };
  [web, inviting] = await Promise.all([
    startWeb(pg),
    startWeb(pg, {
      INVITE_REQUESTS: "on",
      INVITE_REQUEST_SMTP_URL_FILE: file("smtp", ["smtps://user", "pass@localhost:1"].join(":")),
      INVITE_REQUEST_TO_FILE: file("to", "owner@unset.example"),
      INVITE_REQUEST_FROM: "noreply@unset.example",
    }),
  ]);
}, 120_000);
afterAll(async () => {
  await Promise.all([web?.stop(), inviting?.stop()]);
  rmSync(secrets, { recursive: true, force: true });
  await indexer.end();
  await webPool.end();
});

const get = (path: string, init: { method?: string; cookie?: string } = {}) =>
  web.fetch(path, {
    method: init.method ?? "GET",
    headers: { "x-forwarded-for": clientAddress(), ...(init.cookie ? { cookie: init.cookie } : {}) },
  });

/** Headers that may differ between two equal responses. */
const kept = (response: Response) =>
  [...response.headers].filter(([name]) => !["content-length", "date", "x-request-id"].includes(name));

describe("public profile", () => {
  test("profile_renders_from_the_index_with_no_script", async () => {
    const response = await get(`/@${SHOWN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("vary")).toBe("Cookie"); // the session is read when sent (ADR 0078)
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    const html = await response.text();
    expect(html).toContain("<title>Shown Member</title>");
    expect(html).toContain("Card of Shown Member");
    expect(html).toContain("&lt;b>Head&lt;/b>");
    expect(html).not.toContain("<b>Head</b>");
    expect(html).not.toContain("<script");
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain('data-surface="filled"');
  });

  test("a_stored_card_surface_reaches_the_page", async () => {
    const html = await (await get("/@alice.unset.org")).text();
    expect(html).toContain("Card of Alice");
    expect(html).toContain('data-surface="plain"');
  });

  test("message_link_goes_to_the_door_by_did: the same link for every visitor, naming no chat account", async () => {
    // Build step 10 (ADR 0094 decision 6, ADR 0101 decision 3): the door finds the chat ID only for a signed-in browser.
    const html = await (await get(`/@${SHOWN}`)).text();
    const links = [...html.matchAll(/href="(https:\/\/staging\.unset\.cc\/[^"]*)"(.*?)<\/a>/gs)];
    expect(links.map(([, href]) => href)).toEqual([`https://staging.unset.cc/dm/${SHOWN}`]);
    expect(links[0]?.[2]).toContain("Message");
    const alice = await (await get("/@alice.unset.org")).text();
    expect(alice).toContain(`href="https://staging.unset.cc/dm/${NAMED}"`);
  });

  test("canonical_redirects_to_the_verified_handle", async () => {
    for (const path of [`/@${NAMED}`, "/@ALICE.unset.org"]) {
      const response = await get(path);
      expect(response.status, path).toBe(301);
      expect(response.headers.get("location"), path).toBe("/@alice.unset.org");
    }
    const page = await get("/@alice.unset.org");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Card of Alice");
  });

  test("did_path_stays_when_the_handle_is_not_verified", async () => {
    expect((await get(`/@${UNVERIFIED}`)).status).toBe(200);
    expect(await (await get(`/@${UNVERIFIED}`)).text()).not.toContain("mallory.unset.org");
  });

  test("every_missing_or_hidden_actor_is_the_same_404", async () => {
    const missing = await get(`/@did:plc:${"z".repeat(24)}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    expect(missing.headers.get("cache-control")).toBe("no-cache");
    // The shell's Sign in link returns to the page asked for, the one part that names the path (the same for every
    // actor, shown or not), and the ETag hashes the body; both are set aside.
    const unpathed = (html: string) => html.replace(/\/login\?next=[^"]*"/g, '/login?next="');
    const headers = (response: Response) => kept(response).filter(([name]) => name !== "etag");
    const body = unpathed(await missing.text());
    expect(body).not.toContain("<script");
    for (const path of [
      `/@${HIDDEN}`,
      `/@${BARE}`,
      "/@mallory.unset.org",
      "/@nobody.unset.org",
      "/@%3Cscript%3E",
      `/@${SHOWN.toUpperCase()}`,
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(unpathed(await response.text()), path).toBe(body);
      expect(headers(response), path).toEqual(headers(missing));
    }
  });

  test("a_cookie_that_is_no_session_reads_as_a_visitor", async () => {
    const plain = await get(`/@${SHOWN}`);
    const withCookie = await get(`/@${SHOWN}`, { cookie: "__Host-sid=untrusted" });
    expect(withCookie.status).toBe(200);
    // The gate clears a cookie it does not know, so this answer is never stored; it shows what a visitor sees.
    expect(withCookie.headers.get("cache-control")).toBe("private, no-store");
    expect(await withCookie.text()).toBe(await plain.text());
  });

  test("never_more_cards_than_the_owner_page_reads", async () => {
    const html = await (await get(`/@${MANY}`)).text();
    const shown = (html.match(/Card of Many/g) ?? []).length + (html.match(/Extra card/g) ?? []).length;
    expect(shown).toBe(CARDS_MAX);
  });

  test("only_reads", async () => {
    const post = await web.fetch(`/@${SHOWN}`, {
      method: "POST",
      headers: {
        "x-forwarded-for": clientAddress(),
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "1",
      },
      body: "a",
    });
    expect(post.status).toBe(405);
  });
});

/** What a page that is not public must never carry: its cards, headline and link-preview tags. */
function expectLimited(html: string, name: string) {
  expect(html).toContain(`<title>${name}</title>`);
  expect(html).toContain(name);
  expect(html).not.toContain(`Card of ${name}`);
  expect(html).not.toContain("Head");
  expect(html).not.toContain("og:");
  expect(html).not.toContain('rel="canonical"');
  expect(html).toContain('<meta name="robots" content="noindex"');
}

describe("page visibility (ADR 0078)", () => {
  test("signed_in_only_gives_a_visitor_the_limited_page_with_a_sign_in_link", async () => {
    const response = await get("/@bea.unset.org");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("vary")).toBe("Cookie");
    const html = await response.text();
    expectLimited(html, "Bea");
    expect(html).toContain('data-limited="signedIn"');
    expect(html).toContain("data-limited-sign-in");
    expect(html).toContain(`/login?next=${encodeURIComponent("/@bea.unset.org")}`);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("data-limited-sign-up"); // invite requests are off on this server
  });

  test("signed_in_only_offers_a_visitor_sign_up_when_invite_requests_are_on", async () => {
    const html = await (
      await inviting.fetch("/@bea.unset.org", { headers: { "x-forwarded-for": clientAddress() } })
    ).text();
    expect(html).toContain("data-limited-sign-in");
    expect(html).toContain('href="/request-invite" data-limited-sign-up');
    const ownerOnly = await (
      await inviting.fetch("/@cy.unset.org", { headers: { "x-forwarded-for": clientAddress() } })
    ).text();
    expect(ownerOnly).not.toContain("data-limited-sign-up"); // joining would not show it
  });

  test("signed_in_only_shows_a_member_the_whole_page_privately_and_never_indexed", async () => {
    const response = await get("/@bea.unset.org", { cookie: await signedIn(OTHER) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    expect(html).toContain("Card of Bea");
    expect(html).toContain('data-page-audience="signedIn"');
    expect(html).not.toContain("og:");
  });

  test("only_me_gives_everyone_but_the_owner_the_limited_page_with_no_sign_in", async () => {
    for (const cookie of [undefined, await signedIn(OTHER)]) {
      const response = await get("/@cy.unset.org", cookie === undefined ? {} : { cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      const html = await response.text();
      expectLimited(html, "Cy");
      expect(html).toContain('data-limited="ownerOnly"');
      expect(html).not.toContain("data-limited-sign-in"); // signing in would not show it
    }
    const own = await get("/@cy.unset.org", { cookie: await signedIn(ONLY_ME) });
    const html = await own.text();
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Card of Cy");
    expect(html).toContain('data-page-audience="ownerOnly"');
  });

  test("the_owner_on_the_public_page_gets_a_link_to_edit_it_and_no_one_else_does", async () => {
    const own = await get("/@alice.unset.org", { cookie: await signedIn(NAMED) });
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    const ownHtml = await own.text();
    expect(ownHtml).toContain(`href="/${NAMED}"`);
    expect(ownHtml).toContain("Edit your page");
    expect(ownHtml).not.toContain("<script");
    // Right after the owner's visit: a visitor's copy and another member's copy never carry the link.
    for (const cookie of [undefined, await signedIn(OTHER)]) {
      const html = await (await get("/@alice.unset.org", cookie === undefined ? {} : { cookie })).text();
      expect(html).toContain("Card of Alice");
      expect(html).not.toContain("Edit your page");
      expect(html).not.toContain(`href="/${NAMED}"`);
    }
  });

  test("a_visibility_we_do_not_know_reads_as_only_me", async () => {
    const html = await (await get(`/@${FUTURE}`)).text();
    expectLimited(html, "Future");
    expect(html).toContain('data-limited="ownerOnly"');
  });
});
