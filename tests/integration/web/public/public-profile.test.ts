// P3.12s: the public profile at /@<handle> and /@<DID> on the built web server, read from the index as `web` through
// the views of migration 0030 (TE-2). The index is written as `indexer`, the role that writes it in production. No
// network: the page never reads a PDS. Decision 35 D7 and rule SE-2: every account the page may not show, and every
// path that is no actor, gets one 404 with the same bytes and headers.
import { relative } from "node:path";
import { CARDS_MAX, toCardRecord } from "@unset/domains-profile";
import { createPool, withClient } from "@unset/infrastructure-postgres";
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

const NOW = "2026-11-19T00:00:00.000Z";
const SHOWN = `did:plc:${"p".repeat(24)}`;
const NAMED = `did:plc:${"q".repeat(24)}`;
const HIDDEN = `did:plc:${"r".repeat(24)}`;
const BARE = `did:plc:${"s".repeat(24)}`;
const UNVERIFIED = `did:plc:${"t".repeat(24)}`;
const MANY = `did:plc:${"u".repeat(24)}`;

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
  } = {},
) {
  const { handle = null, status = "unresolved", active = true, name = "Member", profile = true } = opts;
  const card = toCardRecord({ kind: "readme", text: `Card of ${name}` }, "full", null, NOW, opts.surface);
  if (!card.ok) throw new Error(`seed card did not build: ${card.code}`);
  const record = { $type: "sh.unset.profile", displayName: name, headline: "<b>Head</b>", createdAt: NOW };
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
      [`at://${did}/sh.unset.section/3jzfcijpj2z2a`, did, card.record],
    );
  });
}

/** `count` more README cards for `did`, keys after the first card's, each saying "Extra card". */
async function moreCards(did: string, count: number) {
  const card = toCardRecord({ kind: "readme", text: "Extra card" }, "full", null, NOW);
  if (!card.ok) throw new Error(`seed card did not build: ${card.code}`);
  await withClient(indexer, null, async (c) => {
    for (let i = 0; i < count; i += 1) {
      const rkey = `extra${String(i).padStart(3, "0")}`;
      await c.query(
        `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
         VALUES ($1, $2, $3, 'cid-s', '3l', $4, NULL, now())`,
        [`at://${did}/sh.unset.section/${rkey}`, did, rkey, card.record],
      );
    }
  });
}

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  await indexed(SHOWN, { name: "Shown Member" });
  await indexed(NAMED, { handle: "alice.unset.org", status: "verified", name: "Alice", surface: "plain" });
  await indexed(HIDDEN, { active: false, name: "Hidden Member" });
  await indexed(BARE, { profile: false, name: "Bare Member" });
  await indexed(UNVERIFIED, { handle: "mallory.unset.org", status: "invalid", name: "Mallory" });
  await indexed(MANY, { name: "Many" });
  await moreCards(MANY, CARDS_MAX);
  web = await startWeb(pg);
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await indexer.end();
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
    expect(response.headers.get("vary")).toBeNull();
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
    // Build step 10 (ADR 0082 decision 6, ADR 0090 decision 3): the door finds the chat ID only for a signed-in browser.
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

  test("no_cookie_changes_the_page", async () => {
    const plain = await get(`/@${SHOWN}`);
    const withCookies = await get(`/@${SHOWN}`, { cookie: "__Host-sid=untrusted; __Host-theme=dark" });
    expect(withCookies.headers.get("set-cookie")).toBeNull();
    expect(kept(withCookies)).toEqual(kept(plain));
    expect(await withCookies.text()).toBe(await plain.text());
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
