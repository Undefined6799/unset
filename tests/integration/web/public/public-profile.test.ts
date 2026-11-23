// P3.12s: the public profile at /@<handle> and /@<DID> on the built web server, read from the index as `web` through
// the views of migration 0030 (TE-2). The index is written as `indexer`, the role that writes it in production. No
// network: the page never reads a PDS. Decision 35 D7 and rule SE-2: every account the page may not show, and every
// path that is no actor, gets one 404 with the same bytes and headers. ADR 0078 (P1.22a): a page shown to signed-in
// members only, or only to its member, gives anyone it leaves out the limited page, never the 404, and is never offered
// to search engines; the session is read when a cookie is sent. Book P1.22h: SvelteKit also answers each page at
// `<page>/__data.json` (../data-address.ts), and that address gives every viewer the page's own answers and no more.
// Book P1.22e (ADR 0114): the page runs SvelteKit's client under the app group's script policy, pinned here by value;
// its 404, its refusals and its data address keep the public group's fixed policy; and what the start-up script
// hands the browser is what the data address answers, held to what each viewer's page shows (rule SE-3).
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { CARDS_MAX, type CardContent, toCardRecord } from "@unset/domains-profile";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createNotificationStore,
  createOAuthSessionStore,
  createPool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";
import {
  DATA,
  dataAnswer,
  elementsOf,
  fieldsOf,
  inlineScripts,
  LAYOUT_ONLY,
  leaves,
  nodeData,
  pageText,
  scriptCount,
  startup,
  startupData,
  undrawn,
} from "../data-address.ts";
import { readyMember } from "../members.ts";

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
const inbox = createNotificationStore();

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
const WHOLE = `did:plc:${"d".repeat(24)}`;
const HOSTILE = `did:plc:${"h".repeat(24)}`;

/** Text that would be markup, a handler or a script address if anything read it as one. */
const HOSTILE_TEXT = {
  close: "</script><script>globalThis.ran = 1</script>",
  handler: '<img src=x onerror="globalThis.ran = 1">',
  address: "javascript:globalThis.ran=1",
  comment: "<!-- <script> -->",
} as const;

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
    /** More fields of the profile record: its place and website. */
    fields?: Readonly<Record<string, string>>;
  } = {},
) {
  const { handle = null, status = "unresolved", active = true, name = "Member", profile = true } = opts;
  const card = toCardRecord({ kind: "readme", text: `Card of ${name}` }, "full", null, NOW, opts.surface);
  if (!card.ok) throw new Error(`seed card did not build: ${card.code}`);
  const record = {
    $type: "sh.unset.profile",
    displayName: name,
    headline: "<b>Head</b>",
    ...opts.fields,
    createdAt: NOW,
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
    // The main page lists the card, so it shows, and says who sees it (ADR 0086 point 3, ADR 0091).
    const page = {
      $type: "sh.unset.page",
      cards: [{ uri: `at://${did}/sh.unset.card/3jzfcijpj2z2a` }],
      ...(opts.visibility === undefined ? {} : { visibility: opts.visibility }),
      createdAt: NOW,
    };
    await c.query(
      `INSERT INTO idx.page (did, uri, cid, rev, record, indexed_at) VALUES ($1, $2, 'cid-g', '3l', $3, now())`,
      [did, `at://${did}/sh.unset.page/self`, page],
    );
    await c.query(
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
       VALUES ($1, $2, '3jzfcijpj2z2a', 'cid-s', '3l', $3, 0, now())`,
      [`at://${did}/sh.unset.card/3jzfcijpj2z2a`, did, card.record],
    );
  });
}

/**
 * More cards for `did`, keys after the first card's, listed after it by the main page as the indexer stores a list
 * (each card's position is its place in the list).
 */
async function moreCards(did: string, contents: readonly CardContent[]) {
  const records = contents.map((content) => {
    const card = toCardRecord(content, "full", null, NOW);
    if (!card.ok) throw new Error(`seed card did not build: ${card.code}`);
    return card.record;
  });
  const rkeys = records.map((_, i) => `extra${String(i).padStart(3, "0")}`);
  await withClient(indexer, null, async (c) => {
    for (const [i, rkey] of rkeys.entries()) {
      await c.query(
        `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
         VALUES ($1, $2, $3, 'cid-s', '3l', $4, $5, now())`,
        [`at://${did}/sh.unset.card/${rkey}`, did, rkey, records[i], i + 1],
      );
    }
    const extra = rkeys.map((rkey) => ({ uri: `at://${did}/sh.unset.card/${rkey}` }));
    await c.query(
      `UPDATE idx.page SET record = jsonb_set(record, '{cards}', (record -> 'cards') || $2::jsonb) WHERE did = $1`,
      [did, JSON.stringify(extra)],
    );
  });
}

/**
 * One card of each kind, each with words of its own, so a word the data holds and the page does not show is seen. The
 * Text card's Markdown marks are never shown as typed: the page draws what they mean.
 */
const EVERY_KIND: readonly CardContent[] = [
  { kind: "readme", text: "Dana writes **boldly** and [links out](https://dana.example/readme)." },
  {
    kind: "links",
    title: "Dana links",
    layout: "list",
    items: [{ uri: "https://dana.example/one", label: "Dana one", description: "First of Dana" }],
  },
  {
    kind: "collection",
    title: "Dana work",
    layout: "grid",
    items: [{ title: "Dana piece", tag: "Dana tag", description: "Made by Dana", uri: "https://dana.example/piece" }],
  },
  {
    kind: "buttons",
    heading: "Reach Dana",
    text: "Dana answers",
    buttons: [
      { kind: "email", address: "dana@dana.example" },
      { kind: "link", preset: "custom", uri: "https://dana.example/call", label: "Call Dana" },
    ],
  },
];

/**
 * Two cards of `did` that its page must not show: one the main page does not list (in the repo, off the page), and one
 * it lists whose kind this version does not read. Each holds words of its own.
 */
async function hiddenCards(did: string) {
  const unlisted = toCardRecord({ kind: "readme", text: "Unlisted words" }, "full", null, NOW);
  if (!unlisted.ok) throw new Error(`seed card did not build: ${unlisted.code}`);
  const unread = {
    $type: "sh.unset.card",
    content: { $type: "sh.unset.block.later", text: "Unread words" },
    createdAt: NOW,
  };
  await withClient(indexer, null, async (c) => {
    const rows: [rkey: string, record: unknown, position: number | null][] = [
      ["unlisted000", unlisted.record, null],
      ["unread00000", unread, 90],
    ];
    for (const [rkey, record, position] of rows) {
      await c.query(
        `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
         VALUES ($1, $2, $3, 'cid-s', '3l', $4, $5, now())`,
        [`at://${did}/sh.unset.card/${rkey}`, did, rkey, record, position],
      );
    }
    await c.query(
      `UPDATE idx.page SET record = jsonb_set(record, '{cards}', (record -> 'cards') || $2::jsonb) WHERE did = $1`,
      [did, JSON.stringify([{ uri: `at://${did}/sh.unset.card/unread00000` }])],
    );
  });
}

/**
 * A card of each kind whose every text field is hostile text, and whose addresses include a script address beside a
 * real one: a PDS stores what its member writes, so the page's own read is what keeps it out.
 */
const HOSTILE_CARDS: readonly CardContent[] = [
  { kind: "readme", text: `${HOSTILE_TEXT.close} [link](${HOSTILE_TEXT.address}) ${HOSTILE_TEXT.handler}` },
  {
    kind: "links",
    title: HOSTILE_TEXT.close,
    layout: "list",
    items: [
      { uri: "https://eve.example/one", label: HOSTILE_TEXT.handler, description: HOSTILE_TEXT.address },
      { uri: HOSTILE_TEXT.address, label: "Script address", description: HOSTILE_TEXT.comment },
    ],
  },
  {
    kind: "collection",
    title: HOSTILE_TEXT.handler,
    layout: "grid",
    items: [
      {
        title: HOSTILE_TEXT.close,
        tag: HOSTILE_TEXT.comment,
        description: HOSTILE_TEXT.handler,
        uri: "https://eve.example/piece",
      },
      { title: "Script piece", tag: "", description: "", uri: HOSTILE_TEXT.address },
    ],
  },
  {
    kind: "buttons",
    heading: HOSTILE_TEXT.close,
    text: HOSTILE_TEXT.handler,
    buttons: [
      { kind: "link", preset: "custom", uri: "https://eve.example/call", label: HOSTILE_TEXT.handler },
      { kind: "link", preset: "custom", uri: HOSTILE_TEXT.address, label: "Script button" },
    ],
  },
];

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
  await moreCards(MANY, Array<CardContent>(CARDS_MAX).fill({ kind: "readme", text: "Extra card" }));
  await indexed(MEMBERS, { handle: "bea.unset.org", status: "verified", name: "Bea", visibility: "signed-in" });
  await indexed(ONLY_ME, { handle: "cy.unset.org", status: "verified", name: "Cy", visibility: "owner-only" });
  await indexed(FUTURE, { name: "Future", visibility: "friendsOfFriends" });
  await indexed(WHOLE, {
    handle: "dana.unset.org",
    status: "verified",
    name: "Dana",
    fields: { location: "Dana town", website: "https://dana.example/home" },
  });
  await moreCards(WHOLE, EVERY_KIND);
  await hiddenCards(WHOLE);
  await indexed(HOSTILE, {
    handle: "eve.unset.org",
    status: "verified",
    name: HOSTILE_TEXT.close,
    fields: { headline: HOSTILE_TEXT.handler, location: HOSTILE_TEXT.comment, website: HOSTILE_TEXT.address },
  });
  await moreCards(HOSTILE, HOSTILE_CARDS);
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

/**
 * The app group's policy, as gate.test.ts pins it for an app page (ADR 0054 decision 4, ADR 0073 decision 3): what a
 * page that runs the client is sent, unchanged (ADR 0114 point 2). The one script hash is the page's own start-up
 * script's, given here as base64 SHA-256.
 */
const scriptPolicy = (startUpHash: string): string =>
  "default-src 'none'; connect-src 'self'; font-src https://unset.test/fonts/; img-src 'self'; " +
  `manifest-src 'self'; object-src 'none'; script-src https://unset.test/_app/ 'sha256-${startUpHash}'; ` +
  "style-src https://unset.test/_app/; style-src-attr 'unsafe-hashes' " +
  "'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=' 'sha256-VLgFcXpEe+O6FcWgF9ZsmG0zmp66HOx0AKvg+TMAbTo='; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; " +
  "trusted-types svelte-trusted-html sveltekit-trusted-url ProseMirrorClipboard; " +
  // The chat box (ADR 0115) goes with every page that runs the client: the door's origin and web's chat sign-in.
  "frame-src https://staging.unset.cc https://unset.test/chat/sign-in";
/** The public group's fixed policy (csp.test.ts zero_script_groups_pinned): no script can run under it. */
const FIXED_POLICY =
  "default-src 'none'; img-src https://unset.test/_app/; style-src https://unset.test/_app/; " +
  "font-src https://unset.test/fonts/; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; " +
  "object-src 'none'; manifest-src 'self'";

/**
 * A page that runs the client: the app policy by value, whose one script hash is the hash of the one script the page
 * carries, so no other inline script could run; no script element with an address; nothing fetched and inlined.
 */
function expectScriptPolicy(response: Response, html: string, who = "") {
  const scripts = inlineScripts(html);
  expect(scripts, who).toHaveLength(1);
  expect(scriptCount(html), who).toBe(1);
  const hash = createHash("sha256")
    .update(scripts[0] ?? "")
    .digest("base64");
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(csp, who).toBe(scriptPolicy(hash));
  expect(csp, who).not.toContain("unsafe-inline");
  expect(csp, who).not.toContain("unsafe-eval");
  expect(html, who).not.toContain("data-sveltekit-fetched");
}

/** An answer no script can run in: the public group's fixed policy, and no script element. */
function expectNoScript(response: Response, html: string, who = "") {
  expect(response.headers.get("content-security-policy"), who).toBe(FIXED_POLICY);
  expect(html, who).not.toContain("<script");
}

describe("public profile", () => {
  test("profile_renders_from_the_index_under_the_app_script_policy", async () => {
    const response = await get(`/@${SHOWN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("vary")).toBe("Cookie"); // the session is read when sent (ADR 0078)
    const html = await response.text();
    expectScriptPolicy(response, html);
    expect(html).toContain("<title>Shown Member</title>");
    expect(html).toContain("Card of Shown Member");
    expect(html).toContain("&lt;b>Head&lt;/b>");
    expect(html).not.toContain("<b>Head</b>");
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain('data-surface="filled"');
  });

  test("a_member_s_copy_and_the_owner_s_have_the_same_script_policy", async () => {
    for (const viewer of [OTHER, SHOWN]) {
      const response = await get(`/@${SHOWN}`, { cookie: await signedIn(viewer) });
      expect(response.headers.get("cache-control"), viewer).toBe("private, no-store");
      expectScriptPolicy(response, await response.text(), viewer);
    }
  });

  // ADR 0114 point 3: only the page itself is switched on. A refusal at the gate is a page with no script under the
  // fixed policy, and so is every answer that is not a 200 page.
  test("a_refusal_on_the_route_keeps_the_fixed_policy_and_no_script", async () => {
    const refused = await web.fetch(`/@${SHOWN}`, {
      method: "POST",
      headers: {
        "x-forwarded-for": clientAddress(),
        origin: ORIGIN,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "1",
      },
      body: "a",
    });
    expect(refused.status).toBe(405);
    expect(refused.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expectNoScript(refused, await refused.text());
    const moved = await get(`/@${NAMED}`);
    expect(moved.status).toBe(301);
    expect(moved.headers.get("content-security-policy")).toBe(FIXED_POLICY);
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
    const body = unpathed(await missing.clone().text());
    // The 404 runs no script (SvelteKit takes `csr` for a failed load's error page from the layouts alone, kit 3.2.0
    // src/runtime/server/page/index.js:276-291) and keeps the fixed policy, whoever asks.
    expectNoScript(missing, await missing.text());
    const asMember = await get(`/@${HIDDEN}`, { cookie: await signedIn(OTHER) });
    expect(asMember.status).toBe(404);
    expectNoScript(asMember, await asMember.text(), "member");
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
    const text = pageText(html);
    const shown = (text.match(/Card of Many/g) ?? []).length + (text.match(/Extra card/g) ?? []).length;
    expect(shown).toBe(CARDS_MAX);
    // The browser is sent no more than the page draws: the start-up script holds the same cards and no others.
    expect((startupData(html, 1) as { cards: unknown[] }).cards).toHaveLength(CARDS_MAX);
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
    expectScriptPolicy(response, html); // the limited page is the same page, for a viewer the choice leaves out
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
    expectScriptPolicy(own, ownHtml); // "View as public" follows the page
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

/**
 * A page and its data address as one viewer gets them, the answer's two nodes read back. The page runs the client
 * (book P1.22e), so its start-up script hands the browser the same two results: they are read out of the HTML and held
 * equal to the data address's, and every test below that holds the data to what the page shows holds both. The data
 * address keeps the fixed policy; the page has the script policy.
 */
async function pageAndData(path: string, cookie?: string) {
  const init = cookie === undefined ? {} : { cookie };
  const page = await get(path, init);
  const data = await get(`${path}${DATA}`, init);
  const answer = await dataAnswer(data.clone());
  const html = await page.text();
  const [layout, leaf] = [nodeData(answer, 0), nodeData(answer, 1)];
  expect(data.headers.get("content-security-policy"), path).toBe(FIXED_POLICY);
  expectScriptPolicy(page, html, path);
  expect(startup(html), path).toMatchObject({ form: null, error: null });
  expect(startup(html)?.data, path).toHaveLength(2);
  expect(startupData(html, 0), path).toEqual(layout);
  expect(startupData(html, 1), path).toEqual(leaf);
  return { page, data, html, layout, leaf };
}

/** The headers a data address shares with its page: the cache rule, Vary and the robots word. */
const SHARED_HEADERS = ["cache-control", "vary", "x-robots-tag"];
const shared = (response: Response) => SHARED_HEADERS.map((name) => [name, response.headers.get(name)]);

/**
 * Fields a component only branches on: a kind, a layout, a card's key, width and avatar crop, whether the bell's read
 * worked. Never drawn as words.
 */
const SWITCHES = new Set([
  "avatarShape",
  "cards[].key",
  "cards[].width",
  "cards[].shown.layout",
  "notifications.state",
]);
const isSwitch = (path: string) => /(^|\.)kind$/.test(path) || SWITCHES.has(path);

/** Everything the page's load sends a viewer shown the whole page: what each card shows, never the record behind it. */
const WHOLE_PAGE_FIELDS = [
  "audience",
  "avatarShape",
  "cards[].key",
  "cards[].shown.blocks[].children[].children[].kind",
  "cards[].shown.blocks[].children[].children[].text",
  "cards[].shown.blocks[].children[].href",
  "cards[].shown.blocks[].children[].kind",
  "cards[].shown.blocks[].children[].text",
  "cards[].shown.blocks[].kind",
  "cards[].shown.buttons[].address",
  "cards[].shown.buttons[].href",
  "cards[].shown.buttons[].label",
  "cards[].shown.heading",
  "cards[].shown.items[].description",
  "cards[].shown.items[].href",
  "cards[].shown.items[].site",
  "cards[].shown.items[].tag",
  "cards[].shown.items[].text",
  "cards[].shown.items[].title",
  "cards[].shown.kind",
  "cards[].shown.layout",
  "cards[].shown.text",
  "cards[].shown.title",
  "cards[].surface",
  "cards[].width",
  "contact.href",
  "contact.label",
  "did",
  "editHref",
  "handle",
  "headline",
  "letter",
  "location",
  "message",
  "meta.description",
  "meta.title",
  "meta.url",
  "name",
  "shell.kind",
  "shell.noindex",
  "shell.wide",
  "website.href",
  "website.text",
];

/** The limited page's data (ADR 0078): who the member is and the way in, nothing of the page. */
const LIMITED_FIELDS = [
  "avatarShape",
  "did",
  "handle",
  "letter",
  "limited.signIn",
  "limited.signUp",
  "name",
  "shell.kind",
  "shell.noindex",
  "shell.wide",
];

/** The root layout's data for a visitor: the shell's flags and the Sign in link, no one's account. */
/** The root layout's data for a member: their own account link, their theme form and their bell. */
const MEMBER_SHELL_FIELDS = [
  "account.path",
  "appOpen",
  "bellOpens",
  "notifications.count",
  "notifications.entries",
  "notifications.more",
  "notifications.state",
  "prefs.returnTo",
  "prefs.theme",
  "privacyNotice",
  "signInHref",
  "signedIn",
  "siteNoindex",
];
/** Each entry of a member's own bell, in place of the empty list. */
const BELL_ENTRY_FIELDS = [
  "notifications.entries[].id",
  "notifications.entries[].reason",
  "notifications.entries[].sentAt",
];

const VISITOR_SHELL = {
  signedIn: false,
  account: undefined,
  appOpen: false,
  prefs: undefined,
  privacyNotice: null,
  notifications: undefined,
  bellOpens: false,
  siteNoindex: true,
};

/** The one answer for an account the page may not show: the code alone, under status 200 (../data-address.ts). */
const MISSING = { type: "error", error: { status: 404, message: "http.not_found" } };

/** The shell's Sign in link returns to the path asked for, shown or not; set aside to compare two answers. */
const unpathed = (body: string) => body.replace(/\/login\?next=[^"]*"/g, '/login?next="');
/** A data answer's headers but its length, which follows the path in the Sign in link. */
const dataHeaders = (response: Response) => kept(response);

describe("the data address (book P1.22h)", () => {
  test("a_visitor_s_data_is_what_their_page_shows_under_the_page_s_headers", async () => {
    const { page, data, html, layout, leaf } = await pageAndData("/@dana.unset.org");
    expect(data.status).toBe(200);
    expect(data.headers.get("content-type")).toBe("application/json");
    expect(shared(data)).toEqual(shared(page));
    expect(data.headers.get("cache-control")).toBe("public, max-age=60");
    expect(data.headers.get("vary")).toBe("Cookie");
    expect(data.headers.get("x-robots-tag")).toBe("noindex");
    expect(data.headers.get("set-cookie")).toBeNull();
    expect(undrawn(leaf, html, isSwitch)).toEqual([]);
    expect(fieldsOf(leaf)).toEqual(WHOLE_PAGE_FIELDS);
    expect(leaf).toMatchObject({ editHref: null, audience: null });
    expect(layout).toEqual({ ...VISITOR_SHELL, signInHref: `/login?next=${encodeURIComponent("/@dana.unset.org")}` });
    expect(undrawn(layout, html, isSwitch)).toEqual([]);
    // The answer is JSON under nosniff, and no `<` reaches it as typed (devalue 5.9.4 escapes it).
    expect(data.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await data.text()).not.toContain("<");
  });

  test("a_member_s_and_the_owner_s_data_is_their_own_copy_and_never_stored", async () => {
    // A notification for a member with an account row, so their bell has an entry (notificationStore.ts INSERT).
    const browser = await signedIn(OTHER);
    await readyMember(webPool, parseDid(OTHER) as Did);
    await withClient(webPool, null, (db) =>
      inbox.insert(db, parseDid(OTHER) as Did, {
        reason: "privacy_notice",
        topic: "2026-11-19",
        dedupeKey: "privacy_notice:data",
      }),
    );
    const member = await pageAndData("/@dana.unset.org", browser);
    const owner = await pageAndData("/@dana.unset.org", await signedIn(WHOLE));
    for (const [who, copy] of Object.entries({ member, owner })) {
      expect(shared(copy.data), who).toEqual(shared(copy.page));
      expect(copy.data.headers.get("cache-control"), who).toBe("private, no-store");
      expect(copy.data.headers.get("vary"), who).toBe("Cookie");
      expect(undrawn(copy.leaf, copy.html, isSwitch), who).toEqual([]);
      expect(fieldsOf(copy.leaf), who).toEqual(WHOLE_PAGE_FIELDS);
    }
    // Only the owner's copy carries the way back to the page they edit.
    expect(member.leaf).toMatchObject({ editHref: null });
    expect(owner.leaf).toMatchObject({ editHref: `/${WHOLE}` });
    // The shell's part is the viewer's own: their account link, their theme form, their bell. No one else's.
    expect(fieldsOf(owner.layout)).toEqual(MEMBER_SHELL_FIELDS);
    expect(owner.layout).toMatchObject({ signedIn: true, account: { path: `/${WHOLE}` }, bellOpens: false });
    expect(member.layout).toMatchObject({ signedIn: true, account: { path: `/${OTHER}` }, bellOpens: false });
    // Two things reach a member that their page does not draw, both their own and in this never-stored copy alone.
    // The Sign in link's address, which only a visitor's page uses: it holds this page's path and nothing else.
    const signInHref = `signInHref: /login?next=${encodeURIComponent("/@dana.unset.org")}`;
    expect(undrawn(owner.layout, owner.html, isSwitch)).toEqual([signInHref]);
    // And the bell's entries (the id, reason and time of each of their own notifications): on a page whose bell is
    // a link, only their count is drawn. They name no one else.
    const withEntries = MEMBER_SHELL_FIELDS.filter((field) => field !== "notifications.entries");
    expect(fieldsOf(member.layout)).toEqual([...withEntries, ...BELL_ENTRY_FIELDS].sort());
    const beside = undrawn(member.layout, member.html, isSwitch).map((line) => line.split(": ")[0]);
    expect(beside).toEqual([...BELL_ENTRY_FIELDS, "signInHref"]);
    expect(member.layout).toMatchObject({ notifications: { count: 1, entries: [{ reason: "privacy_notice" }] } });
    expect(JSON.stringify(member.layout)).not.toContain(WHOLE);
  });

  test("every_missing_or_hidden_actor_is_the_same_data_answer", async () => {
    const path = `/@did:plc:${"z".repeat(24)}`;
    const missing = await get(`${path}${DATA}`);
    expect(missing.status).toBe(200);
    expect(missing.headers.get("cache-control")).toBe("no-cache");
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    expect(shared(missing)).toEqual(shared(await get(path)));
    expect(missing.headers.get("content-security-policy")).toBe(FIXED_POLICY);
    const body = unpathed(await missing.clone().text());
    expect((await dataAnswer(missing)).type === "data").toBe(true);
    for (const hidden of [
      `/@${HIDDEN}`,
      `/@${BARE}`,
      "/@mallory.unset.org",
      "/@nobody.unset.org",
      "/@%3Cscript%3E",
      `/@${SHOWN.toUpperCase()}`,
    ]) {
      const response = await get(`${hidden}${DATA}`);
      expect(response.status, hidden).toBe(200);
      expect(dataHeaders(response), hidden).toEqual(dataHeaders(missing));
      expect(unpathed(await response.clone().text()), hidden).toBe(body);
      const answer = await dataAnswer(response);
      expect(answer.type === "data" && answer.nodes[1], hidden).toEqual(MISSING);
    }
    // A member is told no more than a visitor, in a copy of their own.
    const asMember = await get(`/@${HIDDEN}${DATA}`, { cookie: await signedIn(OTHER) });
    expect(asMember.headers.get("cache-control")).toBe("private, no-store");
    const answer = await dataAnswer(asMember);
    expect(answer.type === "data" && answer.nodes[1]).toEqual(MISSING);
  });

  test("a_page_that_leaves_the_viewer_out_gives_only_the_limited_data", async () => {
    const member = await signedIn(OTHER);
    const cases: [path: string, cookie: string | undefined, signIn: string | null][] = [
      ["/@bea.unset.org", undefined, `/login?next=${encodeURIComponent("/@bea.unset.org")}`],
      ["/@cy.unset.org", undefined, null],
      ["/@cy.unset.org", member, null],
      [`/@${FUTURE}`, undefined, null],
    ];
    for (const [path, cookie, signIn] of cases) {
      const who = `${path} ${cookie === undefined ? "visitor" : "member"}`;
      const { page, data, html, leaf } = await pageAndData(path, cookie);
      expect(shared(data), who).toEqual(shared(page));
      expect(data.headers.get("cache-control"), who).toBe(
        cookie === undefined ? "public, max-age=60" : "private, no-store",
      );
      expect(data.headers.get("x-robots-tag"), who).toBe("noindex");
      expect(fieldsOf(leaf), who).toEqual(LIMITED_FIELDS);
      expect(leaf, who).toMatchObject({ limited: { signIn, signUp: null } });
      expect(undrawn(leaf, html, isSwitch), who).toEqual([]);
      const body = await data.text();
      expect(body, who).not.toContain("Card of");
      expect(body, who).not.toContain("Head");
    }
  });

  test("a_page_for_fewer_than_everyone_gives_those_it_is_shown_to_the_whole_data_privately", async () => {
    const cases: [path: string, viewer: string, audience: string, editHref: string | null][] = [
      ["/@bea.unset.org", OTHER, "signedIn", null],
      ["/@bea.unset.org", MEMBERS, "signedIn", `/${MEMBERS}`],
      ["/@cy.unset.org", ONLY_ME, "ownerOnly", `/${ONLY_ME}`],
    ];
    for (const [path, viewer, audience, editHref] of cases) {
      const who = `${path} ${viewer}`;
      const { page, data, html, leaf } = await pageAndData(path, await signedIn(viewer));
      expect(shared(data), who).toEqual(shared(page));
      expect(data.headers.get("cache-control"), who).toBe("private, no-store");
      expect(data.headers.get("x-robots-tag"), who).toBe("noindex");
      // Not shown to everyone: link previews get nothing (the page's `meta`), here as on the page.
      expect(leaf, who).toMatchObject({ audience, editHref, meta: null, headline: "<b>Head</b>" });
      expect(undrawn(leaf, html, isSwitch), who).toEqual([]);
    }
  });

  test("the_layout_alone_names_no_member_and_is_never_stored", async () => {
    const answers: string[] = [];
    for (const path of [`/@${SHOWN}`, `/@${HIDDEN}`, "/@nobody.unset.org", "/@cy.unset.org"]) {
      const response = await get(`${path}${LAYOUT_ONLY}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("private, no-store");
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex");
      const answer = await dataAnswer(response.clone());
      expect(answer.type === "data" && answer.nodes[1], path).toEqual({ type: "skip" });
      expect(nodeData(answer, 0), path).toEqual({
        ...VISITOR_SHELL,
        signInHref: `/login?next=${encodeURIComponent(path)}`,
      });
      answers.push(unpathed(await response.text()));
    }
    expect(new Set(answers).size).toBe(1);
  });

  test("a_path_that_is_not_canonical_answers_with_the_redirect_alone", async () => {
    for (const path of [`/@${NAMED}`, "/@ALICE.unset.org"]) {
      const response = await get(`${path}${DATA}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("private, no-store");
      expect(await response.json(), path).toEqual({ type: "redirect", status: 301, location: "/@alice.unset.org" });
    }
  });

  test("a_cookie_that_is_no_session_gets_the_visitor_s_data_never_stored", async () => {
    const plain = await get(`/@${SHOWN}${DATA}`);
    const withCookie = await get(`/@${SHOWN}${DATA}`, { cookie: "__Host-sid=untrusted" });
    expect(withCookie.headers.get("cache-control")).toBe("private, no-store");
    expect(withCookie.headers.get("set-cookie")).toMatch(/^__Host-sid=;/);
    expect(await withCookie.text()).toBe(await plain.text());
  });

  test("the_data_address_only_reads_and_a_head_has_the_same_headers", async () => {
    const post = await web.fetch(`/@${SHOWN}${DATA}`, {
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
    const head = await get(`/@${SHOWN}${DATA}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(shared(head)).toEqual(shared(await get(`/@${SHOWN}${DATA}`)));
  });
});

/** Words of the two cards Dana's page must not show (hiddenCards). */
const HIDDEN_WORDS = ["Unlisted words", "Unread words", "unlisted000", "unread00000", "sh.unset.block.later"];

describe("what the browser is sent (book P1.22e, rule SE-3)", () => {
  // The start-up script and the data address hold the whole result of the page's load and the root layout's, drawn or
  // not. pageAndData holds the two equal; here each viewer's copy is held to its fields by name and to what is drawn.
  test("each_viewer_s_start_up_data_is_what_their_page_shows", async () => {
    const member = await signedIn(OTHER);
    const cases: [who: string, path: string, cookie: string | undefined, fields: readonly string[]][] = [
      ["visitor", "/@dana.unset.org", undefined, WHOLE_PAGE_FIELDS],
      ["member", "/@dana.unset.org", member, WHOLE_PAGE_FIELDS],
      ["owner", "/@dana.unset.org", await signedIn(WHOLE), WHOLE_PAGE_FIELDS],
      ["visitor at a members' page", "/@bea.unset.org", undefined, LIMITED_FIELDS],
      ["member at an only-me page", "/@cy.unset.org", member, LIMITED_FIELDS],
    ];
    for (const [who, path, cookie, fields] of cases) {
      const { html, data, layout } = await pageAndData(path, cookie);
      const sent = startupData(html, 1);
      expect(fieldsOf(sent), who).toEqual(fields);
      expect(undrawn(sent, html, isSwitch), who).toEqual([]);
      // The shell's part: a visitor's names no one; a member's is their own account, theme and bell (P1.22g ends the
      // two values their page does not draw, pinned in the data address tests above).
      if (cookie === undefined)
        expect(startupData(html, 0), who).toEqual({
          ...VISITOR_SHELL,
          signInHref: (layout as { signInHref: string }).signInHref,
        });
      else expect(startupData(html, 0), who).toMatchObject({ signedIn: true, bellOpens: false });
      for (const text of [html, await data.text()]) {
        for (const word of HIDDEN_WORDS) expect(text, `${who}: ${word}`).not.toContain(word);
      }
    }
  });

  test("a_member_s_start_up_data_names_only_themselves", async () => {
    const { html } = await pageAndData("/@dana.unset.org", await signedIn(OTHER));
    const shell = startupData(html, 0);
    expect(shell).toMatchObject({ account: { path: `/${OTHER}` } });
    expect(JSON.stringify(shell)).not.toContain(WHOLE);
    // Dana's page holds nothing of the viewer: their DID is in the shell's part alone.
    expect(JSON.stringify(startupData(html, 1))).not.toContain(OTHER);
  });

  test("the_limited_page_s_start_up_data_holds_nothing_of_the_page", async () => {
    for (const [path, cookie] of [
      ["/@bea.unset.org", undefined],
      ["/@cy.unset.org", await signedIn(OTHER)],
      [`/@${FUTURE}`, undefined],
    ] as const) {
      const { html } = await pageAndData(path, cookie);
      const [script] = inlineScripts(html);
      expect(script, path).not.toContain("Card of");
      expect(script, path).not.toContain("Head");
      expect(script, path).not.toContain("cards");
    }
  });

  // A member's text reaches the start-up script through devalue's uneval, which writes `<` as an escape (kit 3.2.0
  // src/runtime/server/page/data_serializer.js:99, devalue 5.9.4 src/utils.js:5), and the page as text nodes. Nothing
  // in either closes the script, opens an element or becomes an address.
  test("hostile_text_stays_text_in_the_page_and_in_the_start_up_script", async () => {
    const { html, leaf } = await pageAndData("/@eve.unset.org");
    const [script = ""] = inlineScripts(html);
    expect(scriptCount(html)).toBe(1);
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(script).not.toContain("<");
    // Read back, the text is what the member wrote, to the character.
    expect(startupData(html, 1)).toMatchObject({ name: HOSTILE_TEXT.close, headline: HOSTILE_TEXT.handler });
    expect(undrawn(leaf, html, isSwitch)).toEqual([]);
    // No element, handler or script address came of it: read as a browser's parser reads the page, the only script
    // is the start-up script, there is no img, no attribute is a handler, and no attribute's value is a script address.
    const elements = elementsOf(html);
    expect(elements.filter((element) => element.name === "script")).toHaveLength(1);
    expect(elements.filter((element) => ["img", "iframe", "object", "embed", "base"].includes(element.name))).toEqual(
      [],
    );
    const attributes = elements.flatMap((element) => Object.entries(element.attributes));
    expect(attributes.filter(([name]) => /^on/i.test(name))).toEqual([]);
    expect(attributes.filter(([, value]) => /^\s*(javascript|data|vbscript):/i.test(value))).toEqual([]);
    // Every address the data holds is a real one or none: a script address is dropped where the record is read.
    const addresses = leaves(leaf).filter(([path]) => /(href|url|address)$/i.test(path));
    const real = addresses.filter(([, value]) => typeof value === "string");
    expect(real.length).toBeGreaterThan(3);
    for (const [path, value] of real) expect(value, path).toMatch(/^https:\/\/(eve\.example|unset\.test)\//);
    expect(addresses.filter(([, value]) => typeof value !== "string" && value !== null)).toEqual([]);
    expect(leaf).toMatchObject({ website: null });
  });
});
