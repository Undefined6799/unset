// Build step 10 (ADR 0082 decisions 5 and 6, ADR 0090 decision 2): the chat icon in unset.sh's top bar, on the built
// web server. Postgres as `web` (TE-2). The door's count port is the one thing this test may not reach (TE-1): a
// loopback server that records each request and answers as told. A signed-in member's icon is a plain link to the chat
// page with the number of chats with new messages; a door that is slow, down or odd only hides the number; a visitor
// gets no chat link and web asks nothing about anyone.
import { createServer, type Server } from "node:http"; // guard-allow: egress a loopback stand-in for the door's count port only
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, PDS_HOST, type RunningWeb, startWeb } from "../built-server.ts";
import { readyMember } from "../members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-chat-count-test",
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
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 6).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const PDS = `https://${PDS_HOST}`;
const DOOR = "https://staging.unset.cc";

let dids = 0;
async function signedIn() {
  dids += 1;
  const did = parseDid(`did:plc:${"c".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}`) as Did;
  await tokenSets.set(did, {
    dpopJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d", kid: "dpop", alg: "ES256" } as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did, { issuerOrigin: PDS }));
  await readyMember(pool, did, true);
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}

// The door's count port as told: a status, a body and a delay; and every path it was asked.
const asked: string[] = [];
let answer: { status: number; body: string; delayMs: number };
const door: Server = createServer((request, response) => {
  asked.push(request.url ?? "");
  setTimeout(
    () => response.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body),
    answer.delayMs,
  );
});

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  await new Promise<void>((done) => door.listen(0, "127.0.0.1", done));
  const address = door.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  // The count port's policy is internal: its one origin, private or loopback answers only (net-guard resolve.ts).
  web = await startWeb(pg, { CHAT_DOOR_ORIGIN: DOOR, CHAT_COUNT_URL: `http://127.0.0.1:${port}` });
}, 120_000);
beforeEach(() => {
  asked.length = 0;
  answer = { status: 200, body: '{"unread":3}', delayMs: 0 };
});
afterAll(async () => {
  await web?.stop();
  await new Promise((done) => door.close(done));
  await pool.end();
});

const get = (path: string, cookie?: string) =>
  web.fetch(path, {
    headers: { "x-forwarded-for": clientAddress(), accept: "text/html", ...(cookie === undefined ? {} : { cookie }) },
  });
/** The top bar's links to the chat page, each as its href and accessible name. */
async function chatLinks(path: string, cookie?: string) {
  const response = await get(path, cookie);
  expect(response.status).toBe(200);
  const html = await response.text();
  return [...html.matchAll(/href="(https:\/\/staging\.unset\.cc\/)"(.*?)<\/a>/gs)].map(([, href, inner]) => ({
    href,
    // The rest of the tag (href is the Button's last attribute), then the text inside, tags dropped.
    name: (inner ?? "")
      .replace(/^[^>]*>/, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

describe("the chat icon", () => {
  test("chat_icon.count: a member's icon links to the chat page and says how many chats have new messages", async () => {
    const { did, cookie } = await signedIn();
    const links = await chatLinks("/notifications", cookie);
    expect(links).toHaveLength(1);
    expect(links[0]?.name).toContain("Messages, 3 chats with new messages");
    expect(asked).toEqual([`/count?did=${encodeURIComponent(did)}`]);
  });

  test("chat_icon.none: no number counted yet, or none new, shows the icon with no number", async () => {
    const { cookie } = await signedIn();
    for (const body of ['{"unread":null}', '{"unread":0}']) {
      answer = { status: 200, body, delayMs: 0 };
      const [link] = await chatLinks("/notifications", cookie);
      expect(link?.name).toBe("Messages");
    }
  });

  test.each([
    ["down", { status: 503, body: '{"error":"chat.unavailable"}', delayMs: 0 }],
    ["slow", { status: 200, body: '{"unread":3}', delayMs: 1500 }],
    ["odd", { status: 200, body: '{"unread":"3"}', delayMs: 0 }],
    ["negative", { status: 200, body: '{"unread":-1}', delayMs: 0 }],
    ["not json", { status: 200, body: "3", delayMs: 0 }],
  ])("chat_icon.door_%s: the page still shows, with the icon and no number", async (_name, told) => {
    const { cookie } = await signedIn();
    answer = told;
    const [link] = await chatLinks("/notifications", cookie);
    expect(link?.name).toBe("Messages");
  });

  test("chat_icon.visitor: a visitor gets no chat link, and the door is asked nothing", async () => {
    expect(await chatLinks("/")).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("chat_icon.no_did_in_log: web's log names neither the member nor their number", async () => {
    const { did, cookie } = await signedIn();
    await chatLinks("/notifications", cookie);
    expect(JSON.stringify(web.logs())).not.toContain(did);
  });
});
