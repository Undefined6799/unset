// P1.20g and P1.20i: the member's own page at /:did and its card writes as form actions on the built web server,
// porting the outcomes interfaces/http/routes/profile.test.ts and cards.test.ts check (ADR 0054 decision 5). Postgres
// as `web` (TE-2). The PDS, its authorization server and PLC are the network the server may not reach in a test
// (TE-1): stand-in-server.ts answers them, the PDS from one in-memory repo (stand-in-pds.ts). The OAuth client that
// restores the member's grant and signs each PDS call is real.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "../built-server.ts";
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
const HANDLE = `member.${PDS_HOST}`;
const CARD_A = "3jzfcijpj2z2a";
const CARD_B = "3jzfcijpj2z2b";
const NOW = "2026-11-18T00:00:00.000Z";

function readme(text: string) {
  const built = toCardRecord({ kind: "readme", text }, "full", null, NOW);
  if (!built.ok) throw new Error(`seed card did not build: ${built.code}`);
  return built.record;
}

/** The owner's DID document (their PDS and handle) and the handle's DNS record, so the page can name them. */
function fixture(writesFile: string, failing?: readonly string[]): StandInFixture {
  return {
    http: {
      [`https://plc.directory/${OWNER}`]: {
        body: {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: OWNER,
          alsoKnownAs: [`at://${HANDLE}`],
          verificationMethod: [
            { id: `${OWNER}#atproto`, type: "Multikey", controller: OWNER, publicKeyMultibase: "zQ3sh" },
          ],
          service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
        },
      },
    },
    txt: { [`_atproto.${HANDLE}`]: [`did=${OWNER}`] },
    pds: {
      origin: PDS,
      did: OWNER,
      records: {
        "sh.unset.profile": { self: { $type: "sh.unset.profile", displayName: "Member One", createdAt: NOW } },
        "sh.unset.section": { [CARD_A]: readme("First card"), [CARD_B]: readme("Second card") },
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
  return (await withTransaction(pool, null, (tx) => sessions.create(tx, owner))).cookieValue;
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
    const order = [CARD_B, CARD_A, ...shown.map((w) => w.rkey)];
    const writes = await writesOf(() => action("reorder", order.map((key) => `order=${key}`).join("&")));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "putRecord", collection: "sh.unset.profile", rkey: "self" });
    expect(writes[0]?.record).toMatchObject({ cards: order });
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

  test("the_largest_readme_fits_and_a_form_past_the_card_cap_is_refused_with_a_message", async () => {
    const largest = new URLSearchParams({ kind: "readme", width: "full", text: "é".repeat(50_000) }).toString();
    const fits = await writesOf(async () => expect((await action("create", largest)).status).toBe(303));
    expect(fits).toHaveLength(1);
    const writes = await writesOf(async () => {
      const response = await action("create", `kind=readme&width=full&text=${"x".repeat(330 * 1024)}`);
      expect(response.status).toBe(413);
      expect(await response.text()).toContain("card.form_too_large");
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
