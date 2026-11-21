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
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
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
/** A showcase already holding 50 entries, past the editor's 30 for a new card: only an edit can save that many. */
const CARD_C = "3jzfcijpj2z2c";
const NOW = "2026-11-18T00:00:00.000Z";

/** A stored collection of `entries` rows, built the way the editor builds an edit of a card that already has them. */
function storedCollection(entries: number) {
  const existing = { content: { $type: "sh.unset.block.showcase", items: Array(entries).fill({}) } };
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

/** The profile's card list naming `keys`, at most the lexicon's 100. */
const listOf = (keys: readonly string[]) =>
  keys.slice(0, 100).map((key) => ({ uri: `at://${OWNER}/sh.unset.card/${key}` }));

/** The owner's DID document, naming their PDS. It claims no handle, so the page shows none (identity's tests own that). */
function fixture(
  writesFile: string,
  failing?: readonly string[],
  cards: Record<string, unknown> = {
    [CARD_A]: readme("First card"),
    [CARD_B]: readme("Second card"),
    [CARD_C]: storedCollection(50),
  },
  slow?: Record<string, number>,
): StandInFixture {
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
        // The profile lists the stored cards, up to the lexicon's 100, so they show (ADR 0086 point 3).
        "sh.unset.profile": {
          self: {
            $type: "sh.unset.profile",
            displayName: "Member One",
            createdAt: NOW,
            cards: listOf(Object.keys(cards)),
          },
        },
        "sh.unset.card": cards,
      },
      writesFile,
      ...(failing === undefined ? {} : { failing }),
      ...(slow === undefined ? {} : { slow }),
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

/**
 * A server with the stand-in PDS; `failing` names XRPC methods that answer 503, `cards` replaces the stored cards and
 * `slow` holds named methods' answers.
 */
async function memberServer(
  failing?: readonly string[],
  cards?: Record<string, unknown>,
  slow?: Record<string, number>,
): Promise<Member> {
  const dir = mkdtempSync(join(tmpdir(), "web-member-"));
  const writesFile = join(dir, "writes.jsonl");
  writeFileSync(writesFile, "");
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, KEYRING);
  const web = await startWeb(pg, { SEAL_KEYRING_FILE: keyringFile }, fixture(writesFile, failing, cards, slow));
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
/** The largest collection card the lexicon allows, as the editor's form posts it: 50 entries, each grapheme "a" and
 * four combining accents (nine bytes, the most that fit the schema's byte limits), and a 2,000-byte uri. */
function largestCollection(filler: string, entries = 50): string {
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
 * Sends only the head of a card save framed by `framing` (its Content-Length or Transfer-Encoding line), and resolves
 * with the status line the server answers. The gate refuses a declared length past the route's maxBody, and a body
 * with no declared length, before reading any body (hooks.server.ts requestProblem), and closes the connection;
 * sending the body as well raced that close, and the client's write failed with EPIPE (CI on #1722). If the gate
 * waited for the body instead, no answer would come and the test would time out.
 */
function headOnly(framing: string): Promise<string> {
  const head = [
    `POST /${OWNER}?/create HTTP/1.1`,
    `host: ${HOST}`,
    `origin: ${ORIGIN}`,
    `accept: ${HTML}`,
    `content-type: ${FORM}`,
    `x-forwarded-for: ${clientAddress()}`,
    `cookie: ${cookie}`,
    framing,
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
  test("a_visitor_and_another_member_are_sent_to_the_public_page", async () => {
    // The link a member copies from their own page works for anyone: whoever is not its owner gets the public page,
    // which answers 404 alike for an unknown or hidden account, so the redirect says nothing about the DID.
    for (const [path, headers] of [
      [`/${OWNER}`, {}],
      [`/${OTHER}`, { cookie }],
      ["/did:web:member.example.com", { cookie }],
    ] as const) {
      const response = await page(path, headers);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/@${path.slice(1)}`);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  test("a_path_that_is_not_a_did_is_missing", async () => {
    expect((await page("/not-a-did", { cookie })).status).toBe(404);
    // A DID is compared as written: in capitals it is no DID at all; nor is a did:web on a reserved name.
    expect((await page(`/${OWNER.toUpperCase()}`, { cookie })).status).toBe(404);
    expect((await page("/did:web:member.example", { cookie })).status).toBe(404);
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
    // The card and the profile listing it land in one commit (ADR 0086 point 3).
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      method: "createRecord",
      collection: "sh.unset.card",
      record: { $type: "sh.unset.card", width: "half" },
    });
    expect(writes[1]).toMatchObject({ method: "applyWrites", collection: "sh.unset.profile", rkey: "self" });
    const cards = (writes[1]?.record as { cards?: { uri: string }[] } | undefined)?.cards;
    expect(cards?.at(-1)).toEqual({ uri: `at://${OWNER}/sh.unset.card/${writes[0]?.rkey}` });
    expect(await (await page(`/${OWNER}`, { cookie })).text()).toContain("Hello");
  });

  test("a_save_replaces_the_named_card_only_if_it_has_not_changed", async () => {
    const writes = await writesOf(() =>
      action("save", new URLSearchParams({ key: CARD_A, kind: "readme", width: "full", text: "Edited" }).toString()),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", collection: "sh.unset.card", rkey: CARD_A });
    expect(typeof writes[0]?.swapRecord).toBe("string");
    expect(await (await page(`/${OWNER}`, { cookie })).text()).toContain("Edited");
  });

  test("a_reorder_writes_the_order_into_the_profile_record", async () => {
    const shown = member.writes().filter((w) => w.method === "createRecord");
    const order = [CARD_C, CARD_B, CARD_A, ...shown.map((w) => w.rkey)];
    const writes = await writesOf(() => action("reorder", order.map((key) => `order=${key}`).join("&")));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "applyWrites", collection: "sh.unset.profile", rkey: "self" });
    expect(writes[0]?.record).toMatchObject({
      cards: order.map((key) => ({ uri: `at://${OWNER}/sh.unset.card/${key}` })),
    });
  });

  test("the_avatar_shape_is_written_into_the_profile_and_anything_else_is_refused_first", async () => {
    const writes = await writesOf(() => action("avatar", "avatarShape=roundedSquare"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", collection: "sh.unset.profile", rkey: "self" });
    expect(writes[0]?.record).toMatchObject({ avatarShape: "rounded-square", displayName: "Member One" });
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
    expect(content).toMatchObject({ $type: "sh.unset.block.links", title: "Elsewhere" });
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
    expect(writes).toMatchObject([
      { method: "deleteRecord", collection: "sh.unset.card", rkey: CARD_B },
      { method: "applyWrites", collection: "sh.unset.profile", rkey: "self" },
    ]);
    const cards = (writes[1]?.record as { cards?: { uri: string }[] } | undefined)?.cards ?? [];
    expect(cards.map((card) => card.uri)).not.toContain(`at://${OWNER}/sh.unset.card/${CARD_B}`);
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
    const largest = new URLSearchParams({ kind: "readme", width: "full", text: "é".repeat(5_000) }).toString();
    const fits = await writesOf(async () => expect((await action("create", largest)).status).toBe(303));
    expect(fits.filter((write) => write.method === "createRecord")).toHaveLength(1);
  });

  // The card save cap is 2 MiB (Alex, 2026-11-18 02:17:13Z) so the largest collection still saves as a plain form.
  // A new card holds the editor's 30 entries (CARD_EDIT_LIMITS); a stored card with the lexicon's 50 can be edited at
  // that size (ADR 0086), a form of about 0.7 to 0.9 MB.
  test.each([
    ["an_ascii_uri", "x"],
    ["a_uri_the_form_percent_encodes", "/"],
  ])("the_largest_collection_edit_fits_with_%s", async (_, filler) => {
    const form = `key=${CARD_C}&${largestCollection(filler)}`;
    expect(Buffer.byteLength(form)).toBeGreaterThan(640 * 1024);
    const writes = await writesOf(async () => expect((await action("save", form)).status).toBe(303));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", rkey: CARD_C });
    const items = (writes[0]?.record as { content?: { items?: { uri: string }[] } } | undefined)?.content?.items;
    expect(items).toHaveLength(50);
    expect(items?.[0]?.uri).toBe(`https://a.example/${filler.repeat(2_000 - 18)}`);
  });

  test("the_largest_new_collection_fits_and_one_entry_more_is_too_long", async () => {
    const writes = await writesOf(async () => {
      expect((await action("create", largestCollection("/", 30))).status).toBe(303);
      expect((await action("create", largestCollection("x", 31))).status).toBe(400);
    });
    expect(writes.filter((write) => write.method === "createRecord")).toHaveLength(1);
  });

  test("a_body_past_2_mib_is_refused_with_no_write", async () => {
    const writes = await writesOf(async () => {
      const body = `kind=readme&width=full&text=${"x".repeat(2 * 1024 * 1024)}`;
      expect(await headOnly(`content-length: ${Buffer.byteLength(body)}`)).toMatch(/^HTTP\/1\.1 413 /);
      // A chunked body declares no length, so it is refused before any of it is read; a body longer than the length
      // it declares is cut at that length (gate.test.ts no_route_reads_past_the_length_it_declared).
      expect(await headOnly("transfer-encoding: chunked")).toMatch(/^HTTP\/1\.1 413 /);
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

describe("the one Save (ADR 0074)", () => {
  // Each write gives its card a new version (stand-in-pds.ts, as a real PDS does), so each test starts on a repo whose
  // cards are still at the version they are posted with.
  beforeEach(async () => {
    await member.stop();
    member = await memberServer();
  }, 60_000);
  // The stand-in gives every record this one CID, so it is the version an editor opened; any other is stale.
  const OPENED = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
  const STALE = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae";
  const saveAll = (pairs: [string, string][], headers: Record<string, string> = {}) =>
    action("saveAll", new URLSearchParams(pairs).toString(), headers);
  const text = (n: number, key: string, words: string, version = OPENED): [string, string][] => [
    [`cards.${n}.key`, key],
    [`cards.${n}.version`, version],
    [`cards.${n}.kind`, "readme"],
    [`cards.${n}.width`, "half"],
    [`cards.${n}.text`, words],
  ];
  /** Kit's answer to its own client, read back as the action's data (devalue's flat array). */
  async function refusal(response: Response) {
    const flat = JSON.parse((JSON.parse(await response.text()) as { data: string }).data) as unknown[];
    const data = flat[0] as Record<string, number>;
    return { code: flat[data.code ?? -1], card: flat[data.card ?? -1], field: flat[data.field ?? -1] };
  }

  // P1.21v follow-up (Codex on c6cddd7): the answer the page reads (kit's action JSON, as use:enhance asks for it)
  // names each written card's new version as the PDS gave it, so words typed meanwhile settle on that version.
  test("every_changed_card_is_written_in_one_commit_and_the_page_shows_them", async () => {
    let response: Response | undefined;
    const writes = await writesOf(async () => {
      response = await saveAll([...text(0, CARD_A, "First of two"), ...text(1, CARD_C, "Second of two")], {
        accept: "application/json",
        "x-sveltekit-action": "true",
      });
    });
    expect(response?.status).toBe(200);
    const answer = JSON.parse(await (response as Response).text()) as { type: string; data: string };
    expect(answer.type).toBe("success");
    // devalue's flat array: the root object, its versions list, then each { key, version } by index.
    const flat = JSON.parse(answer.data) as unknown[];
    const at = (index: unknown) => flat[index as number];
    const listed = at((flat[0] as { versions: number }).versions) as number[];
    const versions = listed.map((i) => at(i) as { key: number; version: number });
    // CARD_C shrinks (a collection of 100 becomes one line), so it is sent first (domains/profile inSizeOrder).
    expect(versions.map((entry) => at(entry.key))).toEqual([CARD_C, CARD_A]);
    for (const entry of versions) expect(at(entry.version)).toMatch(/^b[a-z2-7]{20,100}$/);
    expect(versions.map((entry) => at(entry.version))).not.toContain(OPENED);
    expect(writes.map((w) => [w.method, w.rkey])).toEqual([
      ["applyWrites", CARD_C],
      ["applyWrites", CARD_A],
    ]);
    expect(writes[0]?.record).toMatchObject({ width: "half", content: { text: "Second of two" } });
    const shown = await (await page(`/${OWNER}`, { cookie })).text();
    expect(shown).toContain("First of two");
    expect(shown).toContain("Second of two");
  });

  test("a_card_changed_since_its_editor_opened_is_named_and_nothing_is_written", async () => {
    const writes = await writesOf(async () => {
      const response = await saveAll([...text(0, CARD_A, "Mine"), ...text(1, CARD_C, "Theirs", STALE)], {
        accept: "application/json",
      });
      expect(await refusal(response)).toMatchObject({ code: "card.conflict", card: CARD_C });
    });
    expect(writes).toEqual([]);
  });

  test("a_refusal_names_the_card_and_its_field_in_the_saves_own_names", async () => {
    const writes = await writesOf(async () => {
      const response = await saveAll([...text(0, CARD_A, "Fine"), ...text(1, CARD_C, "x".repeat(20_001))], {
        accept: "application/json",
      });
      expect(await refusal(response)).toEqual({ code: "card.too_long", card: CARD_C, field: "cards.1.text" });
    });
    expect(writes).toEqual([]);
  });

  // One post: the member's own limit (30 a minute) is shared with the file's other writes. The other shapes (no
  // version, a stray field, a bad key) are the same check, cardEdits in +page.server.ts and card-form.server.test.ts.
  test("a_card_named_twice_is_refused_before_any_read", async () => {
    const writes = await writesOf(async () => {
      expect((await saveAll([...text(0, CARD_A, "a"), ...text(1, CARD_A, "b")])).status).toBe(400);
    });
    expect(writes).toEqual([]);
  });

  test("a_signed_out_and_a_cross_site_save_never_write", async () => {
    const writes = await writesOf(async () => {
      expect((await saveAll(text(0, CARD_A, "x"), { cookie: "" })).status).toBe(303);
      expect((await saveAll(text(0, CARD_A, "x"), { origin: "https://evil.example" })).status).toBe(403);
    });
    expect(writes).toEqual([]);
  });
});

describe("an unavailable PDS", () => {
  let down: Member;
  beforeAll(async () => {
    down = await memberServer(["getRecord", "listRecords", "applyWrites"]);
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

// C3 (outside review 2026-11-19): two tabs adding at once must never store more cards than the page shows, and a
// member whose repo already holds more (written outside this app) is told how to bring the hidden ones back.
/** `count` README cards under TID-shaped keys. */
const manyCards = (count: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, n) => [`3jzfcijpj3${String(n).padStart(3, "a")}`, readme(`Card ${n}`)]),
  );

describe("the card limit", () => {
  test("two_adds_at_once_at_49_cards_store_one_and_refuse_the_other", async () => {
    // Each listing is held, and the second tab starts while the first waits on its own: both count 49 before either
    // creates, as two tabs pressing Save together do. The second create then lands on a repo that moved.
    const full = await memberServer(undefined, manyCards(49), { listRecords: 400 });
    try {
      const add = () =>
        full.web.fetch(`/${OWNER}?/create`, {
          method: "POST",
          body: "kind=readme&width=full&text=Same+time",
          headers: { origin: ORIGIN, accept: HTML, "content-type": FORM, "x-forwarded-for": clientAddress(), cookie },
        });
      const first = add();
      await new Promise((done) => setTimeout(done, 200));
      const answers = await Promise.all([first, add()]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([303, 409]);
      const refused = answers.find((answer) => answer.status === 409);
      expect(await refused?.text()).toContain("card.too_many");
      expect(full.writes().filter((write) => write.method === "createRecord")).toHaveLength(1);
    } finally {
      await full.stop();
    }
  });

  // Past one PDS call's 1,000,000-byte body, which the stand-in refuses as the real PDS does: twenty links cards with
  // the editor's 30 links of 2,000-byte addresses (about 1.2 MB, inside the form's 2 MiB; ADR 0086's 20,000-byte text
  // no longer gets there within the 50 cards) go in two calls, the second swapping on the commit the first made, so
  // all twenty are saved (ADR 0074 item 1).
  test("twenty_full_cards_save_in_two_chained_calls", async () => {
    const stored = manyCards(20);
    const keys = Object.keys(stored);
    const opened = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
    const many = await memberServer(undefined, stored);
    try {
      const body = new URLSearchParams(
        keys.flatMap((key, n): [string, string][] => [
          [`cards.${n}.key`, key],
          [`cards.${n}.version`, opened],
          [`cards.${n}.kind`, "links"],
          [`cards.${n}.width`, "half"],
          ...Array.from({ length: 30 }, (_, m): [string, string] => [
            `cards.${n}.items.${m}.uri`,
            `https://a.example/${String((n + m) % 10).repeat(2_000 - 18)}`,
          ]),
        ]),
      ).toString();
      const saved = await many.web.fetch(`/${OWNER}?/saveAll`, {
        method: "POST",
        body,
        headers: { origin: ORIGIN, accept: HTML, "content-type": FORM, "x-forwarded-for": clientAddress(), cookie },
      });
      expect(saved.status).toBe(200);
      expect(many.writes().map((write) => [write.method, write.rkey])).toEqual(keys.map((key) => ["applyWrites", key]));
    } finally {
      await many.stop();
    }
  });

  test("more_cards_than_the_page_shows_says_delete_one_and_a_delete_still_works", async () => {
    const over = manyCards(101);
    const crowded = await memberServer(undefined, over);
    try {
      const html = await (
        await crowded.web.fetch(`/${OWNER}`, { headers: { accept: HTML, "x-forwarded-for": clientAddress(), cookie } })
      ).text();
      expect(html).toContain("You have more cards than your page can show.");
      expect(html).not.toContain("could not be loaded");
      const key = Object.keys(over)[0] ?? "";
      const removed = await crowded.web.fetch(`/${OWNER}?/remove`, {
        method: "POST",
        body: `key=${key}`,
        headers: { origin: ORIGIN, accept: HTML, "content-type": FORM, "x-forwarded-for": clientAddress(), cookie },
      });
      expect(removed.status).toBe(303);
      const after = await (
        await crowded.web.fetch(`/${OWNER}`, { headers: { accept: HTML, "x-forwarded-for": clientAddress(), cookie } })
      ).text();
      expect(after).not.toContain("You have more cards than your page can show.");
    } finally {
      await crowded.stop();
    }
  });
});
