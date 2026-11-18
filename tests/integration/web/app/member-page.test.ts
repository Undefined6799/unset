// P1.20g and P1.20i: the member's own page at /:did and its card writes as form actions on the built web server,
// porting the outcomes interfaces/http/routes/profile.test.ts and cards.test.ts check (ADR 0054 decision 5). Postgres
// as `web` (TE-2). The PDS, its authorization server and PLC are the network the server may not reach in a test
// (TE-1): stand-in-server.ts answers them, the PDS from one in-memory repo (stand-in-pds.ts). The OAuth client that
// restores the member's grant and signs each PDS call is real.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net"; // guard-allow: egress writes raw bytes to the loopback test server only
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { toCardRecord } from "@unset/domains-profile";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import {
  buildOnce,
  clientAddress,
  HOST,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "../built-server.ts";
import { readyMember } from "../members.ts";
import type { PdsWrite } from "../stand-in-pds.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-member-page-test",
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
const OWNER = parseDid(`did:plc:${"m".repeat(24)}`) as Did;
const OTHER = parseDid(`did:plc:${"o".repeat(24)}`) as Did;
const CARD_A = "3jzfcijpj2z2a";
const CARD_B = "3jzfcijpj2z2b";
/** A collection already holding 100 entries, past the editor's 30 for a new card: only an edit can save that many. */
const CARD_C = "3jzfcijpj2z2c";
const NOW = "2026-11-18T00:00:00.000Z";

/** A stored collection of `entries` rows, built the way the editor builds an edit of a card that already has them. */
function storedCollection(entries: number) {
  const existing = { content: { $type: "sh.unset.section#collection", items: Array(entries).fill({}) } };
  const items = Array(entries).fill({ title: "t", uri: "https://a.example/" });
  const built = toCardRecord(
    { kind: "collection", title: "Shelf", layout: "list", items } as never,
    "full",
    existing,
    NOW,
  );
  if (!built.ok) throw new Error(`seed card did not build: ${built.code}`);
  return built.record;
}

function readme(text: string) {
  const built = toCardRecord({ kind: "readme", text }, "full", null, NOW);
  if (!built.ok) throw new Error(`seed card did not build: ${built.code}`);
  return built.record;
}

/** The owner's DID document, naming their PDS. It claims no handle, so the page shows none (identity's tests own that). */
function fixture(writesFile: string, failing?: readonly string[]): StandInFixture {
  return {
    http: {
      [`https://plc.directory/${OWNER}`]: {
        body: {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: OWNER,
          verificationMethod: [
            { id: `${OWNER}#atproto`, type: "Multikey", controller: OWNER, publicKeyMultibase: "zQ3sh" },
          ],
          service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
        },
      },
    },
    pds: {
      origin: PDS,
      did: OWNER,
      records: {
        "sh.unset.profile": { self: { $type: "sh.unset.profile", displayName: "Member One", createdAt: NOW } },
        "sh.unset.section": {
          [CARD_A]: readme("First card"),
          [CARD_B]: readme("Second card"),
          [CARD_C]: storedCollection(100),
        },
      },
      writesFile,
      ...(failing === undefined ? {} : { failing }),
    },
  };
}

/** A signed-in browser for `owner`: a grant the OAuth client can restore against the stand-in PDS, then a session. */
async function signedIn(owner: Did): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(owner, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: owner as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, owner));
  await readyMember(pool, owner);
  return created.cookieValue;
}

type Member = { web: RunningWeb; writes: () => PdsWrite[]; stop: () => Promise<void> };

/** A server with the stand-in PDS; `failing` names XRPC methods that answer 503. */
async function memberServer(failing?: readonly string[]): Promise<Member> {
  const dir = mkdtempSync(join(tmpdir(), "web-member-"));
  const writesFile = join(dir, "writes.jsonl");
  writeFileSync(writesFile, "");
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, KEYRING);
  const web = await startWeb(pg, { SEAL_KEYRING_FILE: keyringFile }, fixture(writesFile, failing));
  const writes = () =>
    readFileSync(writesFile, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as PdsWrite);
  return { web, writes, stop: async () => void (await web.stop()) };
}

const FORM = "application/x-www-form-urlencoded";
/** What a browser sends with a plain form post; without it SvelteKit answers an action as JSON for its own client. */
const HTML = "text/html,application/xhtml+xml";

let member: Member;
let cookie: string;
beforeAll(async () => {
  buildOnce(provided.port);
  member = await memberServer();
  cookie = `__Host-sid=${await signedIn(OWNER)}`;
}, 120_000);
afterAll(async () => {
  await member?.stop();
  await pool.end();
});

const page = (path: string, headers: Record<string, string> = {}) =>
  member.web.fetch(path, { headers: { accept: HTML, "x-forwarded-for": clientAddress(), ...headers } });
const action = (name: string, body: string, headers: Record<string, string> = {}) =>
  member.web.fetch(`/${OWNER}?/${name}`, {
    method: "POST",
    body,
    headers: {
      origin: ORIGIN,
      accept: HTML,
      "content-type": FORM,
      "x-forwarded-for": clientAddress(),
      cookie,
      ...headers,
    },
  });
/** The largest collection card the lexicon allows, as the editor's form posts it: 100 entries, each grapheme "a" and
 * four combining accents (nine bytes, the most that fit the schema's byte limits), and a 2,000-byte uri. */
function largestCollection(filler: string, entries = 100): string {
  const heavy = (graphemes: number) => "a\u0301\u0301\u0301\u0301".repeat(graphemes);
  const uri = `https://a.example/${filler.repeat(2_000 - 18)}`;
  const form = new URLSearchParams([
    ["kind", "collection"],
    ["width", "full"],
    ["title", heavy(100)],
  ]);
  for (let i = 0; i < entries; i += 1) {
    form.append(`items.${i}.title`, heavy(120));
    form.append(`items.${i}.tag`, heavy(40));
    form.append(`items.${i}.description`, heavy(300));
    form.append(`items.${i}.uri`, uri);
  }
  return form.toString();
}

/**
 * Sends only the head of a card save that declares a `length`-byte body, and resolves with the status line the server
 * answers. The gate refuses a declared length past the route's maxBody before reading any body (hooks.server.ts
 * requestProblem) and closes the connection; sending the body as well raced that close, and the client's write failed
 * with EPIPE (CI on #1722). If the gate waited for the body instead, no answer would come and the test would time out.
 */
function declaredLength(length: number): Promise<string> {
  const head = [
    `POST /${OWNER}?/create HTTP/1.1`,
    `host: ${HOST}`,
    `origin: ${ORIGIN}`,
    `accept: ${HTML}`,
    `content-type: ${FORM}`,
    `x-forwarded-for: ${clientAddress()}`,
    `cookie: ${cookie}`,
    `content-length: ${length}`,
  ].join("\r\n");
  return new Promise((done, fail) => {
    const socket = connect(member.web.port, "127.0.0.1", () => socket.write(`${head}\r\n\r\n`));
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      answer += chunk;
    });
    socket.once("error", fail);
    socket.once("close", () => done(answer.split("\r\n")[0] ?? ""));
  });
}

/** Runs `step` and returns the PDS writes it made. */
async function writesOf(step: () => Promise<unknown>): Promise<PdsWrite[]> {
  const before = member.writes().length;
  await step();
  return member.writes().slice(before);
}

describe("the member's page", () => {
  test("a_visitor_is_sent_to_sign_in_and_back", async () => {
    const response = await page(`/${OWNER}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/login?next=%2F${encodeURIComponent(OWNER)}`);
  });

  test("a_path_that_is_not_a_did_and_another_members_page_are_missing", async () => {
    expect((await page("/not-a-did", { cookie })).status).toBe(404);
    expect((await page(`/${OTHER}`, { cookie })).status).toBe(404);
    // A did:web member is someone else too, and a DID is compared as written: another case is another DID.
    expect((await page("/did:web:member.example", { cookie })).status).toBe(404);
    expect((await page(`/${OWNER.toUpperCase()}`, { cookie })).status).toBe(404);
    expect(
      (
        await member.web.fetch(`/did:web:member.example?/create`, {
          method: "POST",
          body: "kind=readme&text=x",
          headers: { origin: ORIGIN, accept: HTML, "content-type": FORM, "x-forwarded-for": clientAddress(), cookie },
        })
      ).status,
    ).toBe(404);
  });

  test("the_owner_sees_their_profile_and_cards_privately", async () => {
    const response = await page(`/${OWNER}`, { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("cookie");
    const html = await response.text();
    expect(html).toContain("Member One");
    expect(html).toContain("First card");
    expect(html).toContain("Second card");
    expect(html).toContain(OWNER);
  });
});

describe("card writes", () => {
  test("a_new_card_is_checked_and_written_to_the_owners_repo", async () => {
    let response: Response | undefined;
    const writes = await writesOf(async () => {
      response = await action(
        "create",
        new URLSearchParams({ kind: "readme", width: "half", text: "Hello" }).toString(),
      );
    });
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe(`/${OWNER}`);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "createRecord",
      collection: "sh.unset.section",
      record: { $type: "sh.unset.section", width: "half" },
    });
  });

  test("a_save_replaces_the_named_card_only_if_it_has_not_changed", async () => {
    const writes = await writesOf(() =>
      action("save", new URLSearchParams({ key: CARD_A, kind: "readme", width: "full", text: "Edited" }).toString()),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", collection: "sh.unset.section", rkey: CARD_A });
    expect(typeof writes[0]?.swapRecord).toBe("string");
    expect(await (await page(`/${OWNER}`, { cookie })).text()).toContain("Edited");
  });

  test("a_reorder_writes_the_order_into_the_profile_record", async () => {
    const shown = member.writes().filter((w) => w.method === "createRecord");
    const order = [CARD_C, CARD_B, CARD_A, ...shown.map((w) => w.rkey)];
    const writes = await writesOf(() => action("reorder", order.map((key) => `order=${key}`).join("&")));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", collection: "sh.unset.profile", rkey: "self" });
    expect(writes[0]?.record).toMatchObject({ cards: order });
  });

  test("the_avatar_shape_is_written_into_the_profile_and_anything_else_is_refused_first", async () => {
    const writes = await writesOf(() => action("avatar", "avatarShape=roundedSquare"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", collection: "sh.unset.profile", rkey: "self" });
    expect(writes[0]?.record).toMatchObject({ avatarShape: "roundedSquare", displayName: "Member One" });
    for (const body of ["avatarShape=hexagon", "avatarShape=round&avatarShape=round", "avatarShape=round&key=x", ""]) {
      let response: Response | undefined;
      const refused = await writesOf(async () => {
        response = await action("avatar", body);
      });
      expect(response?.status).toBe(400);
      expect(refused).toHaveLength(0);
    }
  });

  test("a_list_cards_form_rows_are_written_as_its_items", async () => {
    const form = new URLSearchParams([
      ["key", CARD_A],
      ["kind", "links"],
      ["title", "Elsewhere"],
      ["items.0.uri", "a.example"],
      ["items.0.label", "A"],
      ["items.1.uri", ""],
      ["items.2.uri", "b.example"],
    ]).toString();
    const writes = await writesOf(() => action("save", form));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", rkey: CARD_A });
    const content = (writes[0]?.record as { content?: { items?: { uri: string }[] } } | undefined)?.content;
    expect(content).toMatchObject({ $type: "sh.unset.section#links", title: "Elsewhere" });
    expect(content?.items?.map((item) => item.uri)).toEqual(["https://a.example", "https://b.example"]);
  });

  test("a_refusal_names_the_field_to_blame_as_the_form_names_it", async () => {
    // The second row read is the form's third (a blank row is skipped), so the editor can mark the field typed in.
    const form = "kind=links&items.0.uri=a.example&items.1.uri=&items.2.uri=not%20a%20url";
    const writes = await writesOf(async () => {
      const refused = await action("create", form, { accept: "application/json" });
      // Kit's answer to its own client: the action's data as devalue's flat array, each field an index into it.
      const flat = JSON.parse((JSON.parse(await refused.text()) as { data: string }).data) as unknown[];
      const data = flat[0] as Record<string, number>;
      const at = (name: string) => flat[data[name] ?? -1];
      expect([at("code"), at("field")]).toEqual(["card.url_invalid", "items.2.uri"]);
      // What was typed comes back too, for the editor drawn in place with no script.
      expect(flat).toContain("not a url");
    });
    expect(writes).toEqual([]);
  });

  test("a_remove_deletes_the_named_card", async () => {
    const writes = await writesOf(() => action("remove", `key=${CARD_B}`));
    expect(writes).toEqual([{ method: "deleteRecord", collection: "sh.unset.section", rkey: CARD_B }]);
  });

  test("a_bad_key_is_a_missing_card_and_an_unknown_kind_is_refused_before_any_write", async () => {
    const writes = await writesOf(async () => {
      expect((await action("remove", "key=..")).status).toBe(404);
      expect((await action("save", "kind=readme&text=x")).status).toBe(404);
      const unknown = await action("create", "kind=poster&text=x");
      expect(unknown.status).toBe(400);
      expect(await unknown.text()).toContain("card.kind_unknown");
      expect((await action("remove", `key=${CARD_A}&kind=readme`)).status).toBe(400);
      expect((await action("create", "kind=readme&text=a&text=b")).status).toBe(400);
      expect((await action("create", "kind=readme&text=a&title=x")).status).toBe(400);
      expect((await action("reorder", `order=${CARD_A}&kind=readme`)).status).toBe(400);
    });
    expect(writes).toEqual([]);
  });

  test("the_largest_readme_fits", async () => {
    const largest = new URLSearchParams({ kind: "readme", width: "full", text: "é".repeat(50_000) }).toString();
    const fits = await writesOf(async () => expect((await action("create", largest)).status).toBe(303));
    expect(fits).toHaveLength(1);
  });

  // The card save cap is 2 MiB (Alex, 2026-11-18 02:17:13Z) so the largest collection still saves as a plain form.
  // A new card holds the editor's 30 entries (CARD_EDIT_LIMITS); a stored card with the lexicon's 100 can be edited at
  // that size. interfaces/http/routes/cards.test.ts posted 100 as JSON past a store double, which never built the record.
  test.each([
    ["an_ascii_uri", "x"],
    ["a_uri_the_form_percent_encodes", "/"],
  ])("the_largest_collection_edit_fits_with_%s", async (_, filler) => {
    const form = `key=${CARD_C}&${largestCollection(filler)}`;
    expect(Buffer.byteLength(form)).toBeGreaterThan(1024 * 1024);
    const writes = await writesOf(async () => expect((await action("save", form)).status).toBe(303));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", rkey: CARD_C });
    const items = (writes[0]?.record as { content?: { items?: { uri: string }[] } } | undefined)?.content?.items;
    expect(items).toHaveLength(100);
    expect(items?.[0]?.uri).toBe(`https://a.example/${filler.repeat(2_000 - 18)}`);
  });

  test("the_largest_new_collection_fits_and_one_entry_more_is_too_long", async () => {
    const writes = await writesOf(async () => {
      expect((await action("create", largestCollection("/", 30))).status).toBe(303);
      expect((await action("create", largestCollection("x", 31))).status).toBe(400);
    });
    expect(writes).toHaveLength(1);
  });

  test("a_body_past_2_mib_is_refused_with_no_write", async () => {
    const writes = await writesOf(async () => {
      const body = `kind=readme&width=full&text=${"x".repeat(2 * 1024 * 1024)}`;
      expect(await declaredLength(Buffer.byteLength(body))).toMatch(/^HTTP\/1\.1 413 /);
    });
    expect(writes).toEqual([]);
  });

  test("a_signed_out_post_and_a_cross_site_post_never_write", async () => {
    const writes = await writesOf(async () => {
      const body = "kind=readme&text=x";
      const signedOut = await action("create", body, { cookie: "" });
      // The gate sends a signed-out write to sign in, back to /me (policy returnTo), as interfaces/http did.
      expect(signedOut.status).toBe(303);
      expect(signedOut.headers.get("location")).toBe("/login?next=%2Fme");
      expect((await action("create", body, { origin: "https://evil.example" })).status).toBe(403);
    });
    expect(writes).toEqual([]);
  });
});

describe("an unavailable PDS", () => {
  let down: Member;
  beforeAll(async () => {
    down = await memberServer(["getRecord", "listRecords", "createRecord"]);
  }, 120_000);
  afterAll(async () => {
    await down?.stop();
  });

  test("the_page_says_so_and_a_write_is_refused_with_its_message", async () => {
    const shown = await down.web.fetch(`/${OWNER}`, {
      headers: { accept: HTML, "x-forwarded-for": clientAddress(), cookie },
    });
    expect(shown.status).toBe(200);
    expect(await shown.text()).not.toContain("First card");
    const refused = await down.web.fetch(`/${OWNER}?/create`, {
      method: "POST",
      body: "kind=readme&text=x",
      headers: { origin: ORIGIN, accept: HTML, "content-type": FORM, "x-forwarded-for": clientAddress(), cookie },
    });
    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain("card.pds_unavailable");
    expect(down.writes()).toEqual([]);
  });
});

// Moved from the React cards' test with P1.20k (ProfileCards.test.tsx): what the Svelte page makes of stored text.
describe("what the page makes of member text", () => {
  test("member_text_is_escaped_and_an_email_button_opens_an_encoded_mailto_link", async () => {
    const collection = new URLSearchParams([
      ["kind", "collection"],
      ["width", "full"],
      ["title", "<script>x</script>"],
      ["layout", "list"],
      ["items.0.title", "<b>"],
    ]);
    const buttons = new URLSearchParams([
      ["kind", "buttons"],
      ["width", "full"],
      ["heading", "Work with me"],
      ["text", "Open to contracts."],
      ["buttons.0.kind", "email"],
      ["buttons.0.address", "a.b+c@x.example"],
    ]);
    for (const form of [collection, buttons]) expect((await action("create", form.toString())).status).toBe(303);
    const html = await (await page(`/${OWNER}`, { cookie })).text();
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script>x&lt;/script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b>");
    expect(html).toContain('href="mailto:a.b%2Bc%40x.example"');
  });
});
