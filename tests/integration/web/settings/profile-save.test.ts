// P1.20h: the profile save (POST /profile) on the built web server against the stand-in PDS (stand-in-pds.ts), the
// outcomes interfaces/http/routes/profile.test.ts checks with a real OAuth client restoring the member's grant and
// signing each call (TE-1: only the PDS and its authorization server are stood in). Postgres as `web` (TE-2). A
// conflict and a dead grant need a PDS that answers InvalidSwap after a read or 401 to a call, which the stand-in does
// not play; save.server.test.ts checks how the action answers both.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { parse } from "parse5";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, PDS_HOST, type RunningWeb, startWeb } from "../built-server.ts";
import { elements, textContent } from "../html.ts";
import { readyMember } from "../members.ts";
import type { PdsWrite } from "../stand-in-pds.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-save-test",
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
// The server unseals the grant this file stores, so both use one keyring, handed to the server by file.
const KEYRING = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyring = parseKeyring(KEYRING);
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });

const PDS = `https://${PDS_HOST}`;
const OWNER = parseDid(`did:plc:${"s".repeat(24)}`) as Did;
const OTHER = `did:plc:${"m".repeat(24)}`;

/** A signed-in browser for OWNER: a grant the OAuth client restores against the stand-in PDS, then a session. */
async function signedIn(): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(OWNER, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: OWNER as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, OWNER, { issuerOrigin: PDS }));
  await readyMember(pool, OWNER);
  return `__Host-sid=${created.cookieValue}`;
}

type Server = { web: RunningWeb; writes: () => PdsWrite[] };

/** A server with the stand-in PDS holding OWNER's repo; `failing` names XRPC methods that answer 503. */
async function server(failing?: readonly string[]): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), "web-save-"));
  const writesFile = join(dir, "writes.jsonl");
  writeFileSync(writesFile, "");
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, KEYRING);
  const pds = { origin: PDS, did: OWNER, records: {}, writesFile, ...(failing === undefined ? {} : { failing }) };
  const web = await startWeb(pg, { SEAL_KEYRING_FILE: keyringFile }, { pds });
  const writes = () =>
    readFileSync(writesFile, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as PdsWrite);
  return { web, writes };
}

let up: Server;
let down: Server;
let unread: Server;
let cookie: string;
beforeAll(async () => {
  buildOnce(provided.port);
  [up, down, unread] = await Promise.all([server(), server(["putRecord"]), server(["getRecord"])]);
  cookie = await signedIn();
}, 120_000);
afterAll(async () => {
  await Promise.all([up?.web.stop(), down?.web.stop(), unread?.web.stop()]);
  await pool.end();
});

/** A browser's plain form post to /profile from our own origin. */
const save = (on: Server, body: string) =>
  on.web.fetch("/profile", {
    method: "POST",
    body,
    headers: {
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      "x-forwarded-for": clientAddress(),
      cookie,
    },
  });

// First in the file: the stand-in repo holds no sh.unset.profile record yet, as for a new member (staging walkthrough
// 2026-11-18 finding 1: no screen created one, so the card editor was out of reach).
describe("a new member with no profile record", () => {
  test("Settings › Profile offers an empty form, and its save creates the record", async () => {
    const page = await up.web.fetch("/settings/profile", {
      headers: { accept: "text/html", "x-forwarded-for": clientAddress(), cookie },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Add a name to start your page.");
    const [form] = elements(parse(html), "form", { method: "post", action: "/profile" });
    expect(elements(form, "input").map((input) => attr(input, "value") ?? "")).toEqual([
      "/settings/profile",
      "",
      "",
      "",
      "",
    ]);
    const before = up.writes().length;
    const response = await save(up, "displayName=New+Member&headline=&location=&website=&next=%2Fsettings%2Fprofile");
    expect(response.headers.get("location")).toBe("/settings/profile?saved");
    const [written] = up.writes().slice(before);
    expect(written).toMatchObject({
      method: "putRecord",
      collection: "sh.unset.profile",
      rkey: "self",
      record: { $type: "sh.unset.profile", displayName: "New Member" },
    });
    expect(written?.swapRecord ?? null).toBeNull(); // a first profile can never overwrite another
  });
});

describe("POST /profile on the stand-in PDS", () => {
  test("saves the session's own profile and returns to it", async () => {
    const before = up.writes().length;
    const response = await save(up, "displayName=+Alice+&headline=Designer.&website=https%3A%2F%2Falice.example");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${OWNER}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const written = up.writes().slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      method: "putRecord",
      collection: "sh.unset.profile",
      rkey: "self",
      record: { displayName: "Alice", headline: "Designer.", website: "https://alice.example" },
    });
  });

  test("Settings › Profile comes back to Settings, and the second save swaps on the first", async () => {
    const before = up.writes().length;
    const response = await save(up, "displayName=Alice&headline=&next=%2Fsettings%2Fprofile");
    expect(response.headers.get("location")).toBe("/settings/profile?saved");
    const [written] = up.writes().slice(before);
    expect(written?.swapRecord).not.toBeNull(); // compare-and-swap on the stored record (DA-4)
  });

  test("a DID in the form never picks whose profile is written (SE-2)", async () => {
    // The stand-in refuses any repo but OWNER's, so a write to OTHER would fail rather than redirect.
    const before = up.writes().length;
    const response = await save(up, `displayName=Mallory&did=${OTHER}&repo=${OTHER}`);
    expect(response.headers.get("location")).toBe(`/${OWNER}`);
    expect(up.writes().slice(before)).toHaveLength(1);
  });

  test("a refused field writes nothing", async () => {
    const before = up.writes().length;
    expect((await save(up, "displayName=A%0AB")).status).toBe(400);
    expect(up.writes()).toHaveLength(before);
  });

  test("an unavailable PDS answers 503 and the session is kept", async () => {
    const response = await save(down, "displayName=Alice");
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("__Host-sid=;");
    expect(down.writes()).toEqual([]);
    const again = await down.web.fetch("/settings/profile", {
      headers: { accept: "text/html", "x-forwarded-for": clientAddress(), cookie },
    });
    expect(again.status).toBe(200);
  });
});

/** A signed-in GET of Settings › Profile. */
const settingsPage = (on: Server) =>
  on.web.fetch("/settings/profile", { headers: { accept: "text/html", "x-forwarded-for": clientAddress(), cookie } });

type Node = Parameters<typeof elements>[0];
const attr = (node: Node | undefined, name: string) =>
  (node as { attrs?: { name: string; value: string }[] } | undefined)?.attrs?.find((a) => a.name === name)?.value;

describe("GET /settings/profile on the stand-in PDS", () => {
  test("the form holds the stored fields and posts to the one profile save", async () => {
    await save(up, "displayName=Mara+Lind&headline=Night+trains.&location=Lund&website=mara.example");
    const response = await settingsPage(up);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const document = parse(await response.text());
    const nav = elements(document, "nav", { "aria-label": "Settings" })[0];
    expect(elements(nav, "a").map((a) => [attr(a, "href"), attr(a, "aria-current") ?? null])).toEqual([
      ["/settings/profile", "page"],
      ["/settings/privacy", null],
      ["/settings/account", null],
    ]);
    const [form, ...others] = elements(document, "form", { method: "post", action: "/profile" });
    expect(others).toEqual([]);
    // Search and AI moved to Settings › Privacy (P1.21y).
    expect(elements(document, "form", { action: "/settings/search-and-ai" })).toEqual([]);
    const inputs = elements(form, "input").map((input) => [attr(input, "name"), attr(input, "value")]);
    expect(inputs).toEqual([
      ["next", "/settings/profile"],
      ["displayName", "Mara Lind"],
      ["headline", "Night trains."],
      ["location", "Lund"],
      ["website", "https://mara.example"],
    ]);
    // No field for what the save cannot write (picture, its shape, listing), and no DID for the save to trust (SE-2).
    expect(inputs.map(([name]) => name)).not.toContain("did");
    expect(elements(form, "button").map((button) => textContent(button).trim())).toEqual(["Save profile"]);
  });

  test("a PDS that cannot be read shows no form, and the session is kept", async () => {
    const response = await settingsPage(unread);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("__Host-sid=;");
    const html = await response.text();
    expect(html).toContain("Your profile could not be loaded");
    expect(elements(parse(html), "form", { action: "/profile" })).toEqual([]);
  });
});

describe("GET /settings/privacy on the stand-in PDS", () => {
  // P1.21y: Search and AI (ADR 0062) on its own settings page, with a search result preview drawn from the same values
  // the public page publishes: the override when set, else the profile's name and headline read from the PDS.
  const privacyPage = (on: Server, query = "") =>
    on.web.fetch(`/settings/privacy${query}`, {
      headers: { accept: "text/html", "x-forwarded-for": clientAddress(), cookie },
    });
  const saveChoices = (on: Server, body: string) =>
    on.web.fetch("/settings/search-and-ai", {
      method: "POST",
      body,
      headers: {
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "x-forwarded-for": clientAddress(),
        cookie,
      },
    });
  const preview = (document: Node | undefined) => {
    const [box] = elements(document, "div", { "data-search-preview": "" });
    const one = (name: string) => elements(box, "p", { [name]: "" }).map(textContent)[0] ?? null;
    return { title: one("data-preview-title"), description: one("data-preview-description"), text: textContent(box) };
  };

  test("the_page_holds_search_and_ai_and_previews_the_profile", async () => {
    await save(up, "displayName=Mara+Lind&headline=Night+trains.&location=&website=");
    expect((await saveChoices(up, "title=&description=")).status).toBe(303);
    const response = await privacyPage(up);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const document = parse(await response.text());
    const nav = elements(document, "nav", { "aria-label": "Settings" })[0];
    expect(elements(nav, "a").map((a) => [attr(a, "href"), attr(a, "aria-current") ?? null])).toEqual([
      ["/settings/profile", null],
      ["/settings/privacy", "page"],
      ["/settings/account", null],
    ]);
    expect(elements(document, "h1").map(textContent)).toEqual(["Privacy"]);
    const [form, ...others] = elements(document, "form", { method: "post", action: "/settings/search-and-ai" });
    expect(others).toEqual([]);
    expect(elements(form, "input").map((input) => [attr(input, "name"), attr(input, "checked") !== undefined])).toEqual(
      [
        ["visibility", true], // Public, with the Search and AI fields under it (ADR 0078)
        ["searchEngines", false],
        ["aiSearch", false],
        ["title", false],
        ["description", false],
        ["visibility", false],
        ["visibility", false],
      ],
    );
    // The title and description sit under a closed "Advanced" while neither is set; no script is needed to open it.
    const [advanced] = elements(form, "details");
    expect(attr(advanced, "open")).toBeUndefined();
    expect(textContent(elements(advanced, "summary")[0]).trim()).toBe(
      "Advanced: search title, description and preview",
    );
    // The preview, inside Advanced (Alex, 2026-11-20 19:21Z): what the public page would publish, at its canonical
    // address, and no link out of the page.
    expect(elements(advanced, "div", { "data-search-preview": "" })).toHaveLength(1);
    const shown = preview(document);
    expect(shown.title).toBe("Mara Lind");
    expect(shown.description).toBe("Night trains.");
    expect(shown.text).toContain(`${new URL(ORIGIN).host} › @${OWNER}`);
    expect(elements(elements(document, "div", { "data-search-preview": "" })[0], "a")).toEqual([]);
    expect(elements(document, "p", { "data-preview-unlisted": "" })).toHaveLength(1);
  });

  test("a_save_comes_back_saying_so_and_the_preview_shows_the_overrides", async () => {
    const saved = await saveChoices(up, "searchEngines=on&title=Mara+%3Cof+the+trains%3E&description=Timetables.");
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/settings/privacy?saved#privacy");
    const html = await (await privacyPage(up, "?saved")).text();
    expect(html).toContain("Privacy saved.");
    expect(html).not.toContain("<of the trains>"); // escaped, as everywhere
    const document = parse(html);
    const shown = preview(document);
    expect(shown.title).toBe("Mara <of the trains>");
    expect(shown.description).toBe("Timetables.");
    // A set override keeps "Advanced" open, so the member always sees it; listing is on, so no "not listed" line.
    expect(attr(elements(document, "details")[0], "open")).toBeDefined();
    expect(elements(document, "p", { "data-preview-unlisted": "" })).toEqual([]);
    expect((await saveChoices(up, "title=&description=")).status).toBe(303);
  });

  test("the_preview_address_is_the_handle_the_public_page_uses", async () => {
    // The indexer's verified handle, as /@<handle> serves it, not this process's handle cache (empty here).
    const indexer = createPool({
      connection: { ...pg, ...provided.roles.indexer, ssl: false },
      service: "indexer-privacy-test",
      max: 1,
      connectTimeoutMs: 5000,
    });
    const record = { $type: "sh.unset.profile", displayName: "Mara Lind", createdAt: "x" };
    try {
      await withClient(indexer, null, async (c) => {
        await c.query("INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())", [
          OWNER,
        ]);
        await c.query(
          "UPDATE idx.account SET handle = 'mara.unset.org', handle_status = 'verified', pds_active = true WHERE did = $1",
          [OWNER],
        );
        await c.query(
          `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
           VALUES ($1, $2, 'cid-p', '3l', $3, 'Mara Lind', false, now())`,
          [OWNER, `at://${OWNER}/sh.unset.profile/self`, record],
        );
      });
      const shown = preview(parse(await (await privacyPage(up)).text()));
      expect(shown.text).toContain(`${new URL(ORIGIN).host} › @mara.unset.org`);
      expect(shown.text).not.toContain(OWNER);
    } finally {
      await withClient(indexer, null, async (c) => {
        await c.query("DELETE FROM idx.profile WHERE did = $1", [OWNER]);
        await c.query("DELETE FROM idx.account WHERE did = $1", [OWNER]);
      });
      await indexer.end();
    }
  });

  // ADR 0078 (P1.22a): who sees the page leads the Privacy page's one form and is written to the profile record; while
  // the page is not public the Search and AI choices are kept as stored, whatever the hidden fields send.
  test("who_sees_the_page_is_saved_in_the_record_and_search_and_ai_waits_until_public", async () => {
    await save(up, "displayName=Mara+Lind&headline=Night+trains.&location=&website=");
    expect((await saveChoices(up, "visibility=public&searchEngines=on&title=&description=")).status).toBe(303);
    const radios = (document: Node | undefined) =>
      elements(elements(document, "form", { action: "/settings/search-and-ai" })[0], "input", {
        name: "visibility",
      }).map((input) => [attr(input, "value"), attr(input, "checked") !== undefined]);
    const before = up.writes().length;
    // Not public: the record changes, and the switch sent off is not saved.
    const saved = await saveChoices(up, "visibility=signedIn&title=&description=");
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/settings/privacy?saved#privacy");
    const [written] = up.writes().slice(before);
    expect(written).toMatchObject({
      record: { displayName: "Mara Lind", headline: "Night trains.", visibility: "signedIn" },
    });
    const html = await (await privacyPage(up, "?saved")).text();
    expect(html).toContain("Privacy saved.");
    const document = parse(html);
    expect(radios(document)).toEqual([
      ["public", false],
      ["signedIn", true],
      ["ownerOnly", false],
    ]);
    const engines = elements(document, "input", { name: "searchEngines" })[0];
    expect(attr(engines, "checked")).toBeDefined(); // kept as stored
    // The Search and AI fields sit under Public, shown by CSS while it is ticked.
    expect(elements(document, "div", { "data-search-under-public": "" })).toHaveLength(1);
    // Each choice's question mark opens its line with no script.
    const helps = elements(document, "section", { popover: "auto" }).map((help) => attr(help, "data-visibility-help"));
    expect(helps.filter((choice) => choice !== undefined)).toEqual(["public", "signedIn", "ownerOnly"]);
    expect(textContent(document)).toContain("does not hide your profile");
    // Public again: the field leaves the record and the switches save again.
    await saveChoices(up, "visibility=public&title=&description=");
    expect(up.writes().at(-1)?.record).not.toHaveProperty("visibility");
    const after = parse(await (await privacyPage(up)).text());
    expect(radios(after)[0]).toEqual(["public", true]);
    expect(attr(elements(after, "input", { name: "searchEngines" })[0], "checked")).toBeUndefined();
  });

  // Staging break test 2026-11-21, second pass: a visitor could still load the page for about 2 s after "Privacy
  // saved". The save now waits, a few seconds at most, until the index the public page reads has the choice.
  test("the_privacy_save_says_saved_only_once_the_public_page_follows", async () => {
    await save(up, "displayName=Mara+Lind&headline=&location=&website=");
    const indexer = createPool({
      connection: { ...pg, ...provided.roles.indexer, ssl: false },
      service: "indexer-catch-up-test",
      max: 1,
      connectTimeoutMs: 5000,
    });
    const indexed = (visibility?: string) =>
      withClient(indexer, null, (c) =>
        c.query("UPDATE idx.profile SET record = $2 WHERE did = $1", [
          OWNER,
          {
            $type: "sh.unset.profile",
            displayName: "Mara Lind",
            createdAt: "x",
            ...(visibility ? { visibility } : {}),
          },
        ]),
      );
    try {
      await withClient(indexer, null, async (c) => {
        await c.query("INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())", [
          OWNER,
        ]);
        await c.query("UPDATE idx.account SET pds_active = true WHERE did = $1", [OWNER]);
        await c.query(
          `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
           VALUES ($1, $2, 'cid-p', '3l', '{}', 'Mara Lind', false, now())`,
          [OWNER, `at://${OWNER}/sh.unset.profile/self`],
        );
      });
      // The index still shows the page to everyone: the save waits, then says the page is catching up.
      await indexed();
      const started = performance.now();
      const slow = await saveChoices(up, "visibility=ownerOnly&title=&description=");
      expect(slow.headers.get("location")).toBe("/settings/privacy?saved=pending#privacy");
      expect(performance.now() - started).toBeGreaterThanOrEqual(4_500);
      expect(await (await privacyPage(up, "?saved=pending")).text()).toContain("still catching up");
      // The index already has the choice: "Privacy saved." at once.
      await indexed("signedIn");
      const fast = await saveChoices(up, "visibility=signedIn&title=&description=");
      expect(fast.headers.get("location")).toBe("/settings/privacy?saved#privacy");
      expect(await (await privacyPage(up, "?saved")).text()).not.toContain("still catching up");
    } finally {
      await withClient(indexer, null, async (c) => {
        await c.query("DELETE FROM idx.profile WHERE did = $1", [OWNER]);
        await c.query("DELETE FROM idx.account WHERE did = $1", [OWNER]);
      });
      await indexer.end();
    }
  }, 30_000);

  // A hidden Search and AI field the save would ignore never blocks restricting who sees the page (Codex on #1851).
  test("a_hidden_overlong_search_field_does_not_block_a_non_public_choice", async () => {
    const before = up.writes().length;
    const response = await saveChoices(up, `visibility=ownerOnly&title=${"x".repeat(71)}&description=`);
    expect(response.status).toBe(303);
    expect(up.writes().slice(before)[0]?.record).toMatchObject({ visibility: "ownerOnly" });
    await saveChoices(up, "visibility=public&title=&description=");
  });

  test.each([
    ["an unknown choice", "visibility=friends&title=&description="],
    ["two choices", "visibility=public&visibility=ownerOnly&title=&description="],
  ])("%s_is_refused_before_anything_is_written", async (_name, body) => {
    const before = up.writes().length;
    expect((await saveChoices(up, body)).status).toBe(400);
    expect(up.writes().length).toBe(before);
  });

  test("a_pds_that_cannot_be_read_still_shows_the_choices_named_by_did", async () => {
    const response = await privacyPage(unread);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("__Host-sid=;");
    const document = parse(await response.text());
    expect(elements(document, "form", { action: "/settings/search-and-ai" })).toHaveLength(1);
    // Who sees the page is in the record, so it is not offered as if it were known (ADR 0078).
    expect(elements(document, "input", { name: "visibility" })).toEqual([]);
    expect(textContent(document)).toContain("We could not read your profile");
    expect(preview(document).title).toBe(OWNER);
    expect(preview(document).description).toBeNull();
  });
});
