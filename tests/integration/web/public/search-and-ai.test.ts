// ADR 0062: a member's Search and AI choices on the built web server, from the settings save to what crawlers and the
// public page see: robots.txt, the sitemap, `noindex`, and the title and description. Postgres as `web` (TE-2); the
// index written as `indexer`. No network: none of these pages reads a PDS. The site-wide switch (P1.21b) is on for
// these servers, as production will have it, and off (its default) for the last block's.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";
import { DATA, dataAnswer, LAYOUT_ONLY, nodeData, startup, startupData } from "../data-address.ts";
import { readyMember } from "../members.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const open = (role: typeof provided.roles.web, service: string) =>
  createPool({ connection: { ...pg, ...role, ssl: false }, service, max: 2, connectTimeoutMs: 5000 });
const pool = open(provided.roles.web, "web-search-ai-test");
const indexer = open(provided.roles.indexer, "indexer-search-ai-test");
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
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const ISSUER = "https://pds.unset.test";
const MEMBER = parseDid(`did:plc:${"v".repeat(24)}`) as Did;
const HANDLE = "vera.unset.org";
const PAGE = `/@${HANDLE}`;
const LISTING_ON = { SEARCH_LISTING: "on" };

/** A signed-in, onboarded member with a stored grant, as public-pages.test.ts makes one. */
async function memberCookie(did: Did): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(did, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: ISSUER,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: ISSUER,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
  await readyMember(pool, did);
  return `__Host-sid=${created.cookieValue}`;
}

/** The member's account and profile as the indexer leaves them, with a verified handle. */
async function indexed(did: string) {
  const record = { $type: "sh.unset.profile", displayName: "Vera", headline: "Maker of <things>", createdAt: "x" };
  await withClient(indexer, null, async (c) => {
    await c.query("INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())", [did]);
    await c.query("UPDATE idx.account SET handle = $2, handle_status = 'verified', pds_active = true WHERE did = $1", [
      did,
      HANDLE,
    ]);
    await c.query(
      `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
       VALUES ($1, $2, 'cid-p', '3l', $3, 'Vera', false, now())`,
      [did, `at://${did}/sh.unset.profile/self`, record],
    );
  });
}

let web: RunningWeb;
let cookie: string;
beforeAll(async () => {
  buildOnce(provided.port);
  cookie = await memberCookie(MEMBER);
  await indexed(MEMBER);
  web = await startWeb(pg, LISTING_ON);
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
  await indexer.end();
});

const get = (path: string) => web.fetch(path, { headers: { "x-forwarded-for": clientAddress() } });
const save = (fields: Record<string, string>, withCookie = cookie) =>
  web.fetch("/settings/search-and-ai", {
    method: "POST",
    headers: {
      "x-forwarded-for": clientAddress(),
      origin: ORIGIN,
      cookie: withCookie,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(Buffer.byteLength(new URLSearchParams(fields).toString())),
    },
    body: new URLSearchParams(fields).toString(),
  });

describe("search and AI", () => {
  test("everything_is_off_until_the_member_turns_it_on", async () => {
    const page = await get(PAGE);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    const html = await page.text();
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${PAGE}"`);
    expect(html).toContain('<meta name="description" content="Maker of &lt;things>"');
    const robots = await (await get("/robots.txt")).text();
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).not.toContain(`Allow: ${PAGE}$`);
    expect(await (await get("/sitemap.xml")).text()).not.toContain(PAGE);
  });

  test("a_signed_out_save_changes_nothing", async () => {
    const refused = await save({ searchEngines: "on" }, "");
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toMatch(/^\/login/);
    expect((await get(PAGE)).headers.get("x-robots-tag")).toBe("noindex");
  });

  test("the_member_turns_both_on_with_a_title", async () => {
    const saved = await save({ searchEngines: "on", aiSearch: "on", title: "Vera <the maker>", description: "" });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/settings/privacy?saved#privacy");
    const page = await get(PAGE);
    expect(page.headers.get("x-robots-tag")).toBeNull();
    const html = await page.text();
    expect(html).not.toContain('content="noindex"');
    expect(html).toContain("<title>Vera &lt;the maker></title>");
    expect(html).toContain('<meta property="og:title" content="Vera &lt;the maker>"');
    expect(await (await get("/robots.txt")).text()).toContain(`Allow: ${PAGE}$`);
    expect(await (await get("/sitemap.xml")).text()).toContain(`<loc>${ORIGIN}${PAGE}</loc>`);
    const home = await get("/");
    expect(home.headers.get("x-robots-tag")).toBeNull();
    expect(await home.text()).not.toContain('content="noindex"');
  });

  // Book P1.22h: the member's choice lists their page, never its data address (`<page>/__data.json`), which holds the
  // same words as JSON. Every answer there says noindex, the layout-only one too, whose page load never runs.
  test("a_listed_page_s_data_address_stays_out_of_search", async () => {
    expect((await get(PAGE)).headers.get("x-robots-tag")).toBeNull();
    const data = await get(`${PAGE}${DATA}`);
    expect(data.status).toBe(200);
    expect(data.headers.get("x-robots-tag")).toBe("noindex");
    expect(data.headers.get("cache-control")).toBe("public, max-age=60");
    // What search results may show is what the page publishes: the member's own title, here as data.
    const leaf = nodeData(await dataAnswer(data), 1);
    expect(leaf).toMatchObject({
      shell: { kind: "core", wide: true },
      meta: { title: "Vera <the maker>", description: "Maker of <things>", url: `${ORIGIN}${PAGE}` },
    });
    // The listed page runs the client (book P1.22e): its start-up script carries the same data, and no more.
    expect(startupData(await (await get(PAGE)).text(), 1)).toEqual(leaf);
    for (const path of [
      `${PAGE}${LAYOUT_ONLY}`,
      DATA,
      `/@nobody.unset.org${DATA}`,
      `/@nobody.unset.org${LAYOUT_ONLY}`,
    ]) {
      expect((await get(path)).headers.get("x-robots-tag"), path).toBe("noindex");
    }
    // AI search crawlers are allowed the page's own address and nothing under it (the `$`).
    expect(await (await get("/robots.txt")).text()).not.toContain(`${PAGE}/`);
  });

  test("a_hidden_account_leaves_robots_and_the_sitemap", async () => {
    await withClient(indexer, null, (c) =>
      c.query("UPDATE idx.account SET pds_active = false WHERE did = $1", [MEMBER]),
    );
    expect(await (await get("/robots.txt")).text()).not.toContain(PAGE);
    expect(await (await get("/sitemap.xml")).text()).not.toContain(PAGE);
    await withClient(indexer, null, (c) =>
      c.query("UPDATE idx.account SET pds_active = true WHERE did = $1", [MEMBER]),
    );
  });

  test("a_bad_form_is_refused_and_keeps_the_choice", async () => {
    expect((await save({ searchEngines: "yes" })).status).toBe(400);
    expect((await save({ title: "x".repeat(71) })).status).toBe(400);
    expect((await get(PAGE)).headers.get("x-robots-tag")).toBeNull();
  });

  test("turning_everything_off_restores_noindex", async () => {
    expect((await save({ title: "", description: "" })).status).toBe(303);
    expect((await get(PAGE)).headers.get("x-robots-tag")).toBe("noindex");
    expect(await (await get("/robots.txt")).text()).not.toContain(PAGE);
  });
});

describe("search and AI when the read fails", () => {
  // The choices are read in the page's own query (a LEFT JOIN), so a failed read is no page at all: the error page
  // keeps noindex, and robots.txt and the sitemap answer 5xx, which RFC 9309 section 2.3.1.4 says crawlers read as
  // "disallow all". The read is made to fail by holding the index locked past a 5 s request deadline (the floor).
  test("a_failed_read_keeps_noindex_and_robots_fails_closed", async () => {
    await save({ searchEngines: "on", aiSearch: "on" });
    const short = await startWeb(pg, { ...LISTING_ON, REQUEST_DEADLINE_MS: "5000" });
    try {
      const fetchShort = (path: string) => short.fetch(path, { headers: { "x-forwarded-for": clientAddress() } });
      const [page, robots, sitemap, data] = await withClient(indexer, null, async (c) => {
        await c.query("BEGIN");
        await c.query("LOCK TABLE idx.account IN ACCESS EXCLUSIVE MODE");
        try {
          return await Promise.all([
            fetchShort(PAGE),
            fetchShort("/robots.txt"),
            fetchShort("/sitemap.xml"),
            fetchShort(`${PAGE}${DATA}`),
          ]);
        } finally {
          await c.query("ROLLBACK");
        }
      });
      expect(page?.status).toBeGreaterThanOrEqual(500);
      const html = (await page?.text()) ?? "";
      expect(html).toContain('<meta name="robots" content="noindex"');
      // The error page runs the client like every other (ADR 0116 point 1; book P1.22k) and still shows its request
      // id: the start-up script carries the code and the id the server made for this request (server.ts, a random
      // UUID, never the caller's text), so the client draws the same line the server did.
      expect(page?.headers.get("content-security-policy")).toMatch(/script-src [^;]*'sha256-/);
      const failed = startup(html)?.error as { message?: string; reqId?: string } | undefined;
      expect(failed).toEqual({
        status: 500,
        message: "internal.error",
        reqId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(html).toContain(`Request id, if you contact us: <code>${failed?.reqId}</code>`);
      // The page's data address runs under the same deadline (book P1.22h): a code and the request id, nothing of the
      // member, never stored and never indexed. SvelteKit sends a failed load as an error node under status 200.
      expect(data?.headers.get("cache-control")).toBe("private, no-store");
      expect(data?.headers.get("x-robots-tag")).toBe("noindex");
      const answer = await dataAnswer(data as Response);
      expect(answer.type === "data" && answer.nodes[1]).toEqual({
        type: "error",
        error: { status: 500, message: "internal.error", reqId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      });
      expect(robots?.status).toBeGreaterThanOrEqual(500);
      expect(sitemap?.status).toBeGreaterThanOrEqual(500);
    } finally {
      await short.stop();
    }
  }, 60_000);
});

describe("search and AI switched off on the whole site", () => {
  // P1.21b: SEARCH_LISTING off, its default, as on staging. A member who turned both choices on is still kept out:
  // every response says noindex, robots.txt refuses AI crawlers and names no member, and the sitemap lists nothing.
  let closed: RunningWeb;
  const getClosed = (path: string) => closed.fetch(path, { headers: { "x-forwarded-for": clientAddress() } });
  beforeAll(async () => {
    closed = await startWeb(pg);
  }, 120_000);
  afterAll(async () => {
    await closed?.stop();
  });

  test("an_opted_in_page_and_home_still_say_noindex", async () => {
    expect((await save({ searchEngines: "on", aiSearch: "on" })).status).toBe(303);
    expect((await get(PAGE)).headers.get("x-robots-tag")).toBeNull(); // the choice holds where listing is on
    for (const path of [PAGE, "/"]) {
      const page = await getClosed(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("x-robots-tag")).toBe("noindex");
      expect(await page.text()).toContain('<meta name="robots" content="noindex"');
    }
  });

  test("robots_lets_search_engines_read_noindex_and_names_no_member", async () => {
    const robots = await getClosed("/robots.txt");
    expect(robots.status).toBe(200);
    const text = await robots.text();
    // Search engines must fetch a page to read its noindex (ADR 0031 Decision 1); AI crawlers are refused everything.
    expect(text).toContain("User-agent: *\nAllow: /\n");
    expect(text).toContain("User-agent: OAI-SearchBot");
    expect(text).toContain("User-agent: GPTBot");
    expect(text).not.toMatch(/^(Sitemap:|Allow: \/@)/m);
    expect(text).not.toContain(HANDLE);
  });

  test("the_sitemap_lists_nothing", async () => {
    const sitemap = await getClosed("/sitemap.xml");
    expect(sitemap.status).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain("<url>");
  });
});
