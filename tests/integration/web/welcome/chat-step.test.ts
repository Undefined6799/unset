// The onboarding chat step (book P6.17; ADR 0083 decision 2, ADR 0082 Consequences) on the built web server, with
// Postgres as `web` (TE-2). Setting up chat is required: the step sends the member to unset.cc, where the chat page
// saves the recovery key and registers the count's pusher, and onboarding finishes only once the door says a browser of
// theirs did (it was given a pushkey, which the page asks for only when the browser is ready). The door's count port is
// the one thing this test may not reach (TE-1): a loopback stand-in that records each request and answers as told.
// While the chat account is not created yet the step says so instead of sending the member to a hop that cannot sign
// them in. A door that is down, slow or odd never finishes the step (fail closed).
import { createServer, type Server } from "node:http"; // guard-allow: egress a loopback stand-in for the door's count port only
import { join, relative } from "node:path";
import { type Did, PRIVACY_VERSION, parseDid, TERMS_VERSION } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createAccountRepository,
  createOAuthSessionStore,
  createPool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { chatAccountsOf } from "../../../support/chat-accounts.ts";
import { buildOnce, clientAddress, ORIGIN, PDS_HOST, type RunningWeb, startWeb } from "../built-server.ts";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-chat-step-test",
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
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 8).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const accounts = createAccountRepository(pool, {
  recordUnderageBlock: async () => {
    throw new Error("this file never blocks");
  },
  chatAccounts: chatAccountsOf(pool),
});
const PDS = `https://${PDS_HOST}`;
const DOOR = "https://staging.unset.cc";
const deadline = () => AbortSignal.timeout(5000);

let dids = 0;
/** A signed-in member at the chat step (terms accepted), with the cached email answer, and their chat account ready
 * unless `chat` is "pending". */
async function atChatStep(options: { chat?: "ready" | "pending"; emailConfirmed?: boolean } = {}) {
  dids += 1;
  const did = parseDid(`did:plc:${"w".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}`) as Did;
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
  await accounts.confirmAdult(did, deadline());
  expect(await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, deadline())).toBe("chat");
  await withTransaction(pool, null, (tx) => sessions.setEmailConfirmed(tx, { did }, options.emailConfirmed ?? false));
  if (options.chat !== "pending") {
    // What the queued job writes once chat-admin has created the account.
    await withClient(pool, null, (db) => db.query("UPDATE app.chat_account SET state = 'ready' WHERE did = $1", [did]));
  }
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}
const onboardingOf = async (did: Did) =>
  (await pool.query<{ onboarding: string }>("SELECT onboarding FROM app.account WHERE did = $1", [did])).rows[0]
    ?.onboarding;

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
const SET_UP = { status: 200, body: '{"setUp":true}', delayMs: 0 };
const NOT_SET_UP = { status: 200, body: '{"setUp":false}', delayMs: 0 };

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  await new Promise<void>((done) => door.listen(0, "127.0.0.1", done));
  const address = door.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  web = await startWeb(pg, { CHAT_DOOR_ORIGIN: DOOR, CHAT_COUNT_URL: `http://127.0.0.1:${port}` });
}, 120_000);
beforeEach(() => {
  asked.length = 0;
  answer = NOT_SET_UP;
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
const post = (path: string, cookie: string, origin = ORIGIN) =>
  web.fetch(path, {
    method: "POST",
    body: "",
    headers: {
      origin,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": clientAddress(),
      cookie,
    },
  });
const location = (response: Response) => response.headers.get("location");
const SET_UP_LINK = `href="${DOOR}/welcome"`;

describe("the onboarding chat step", () => {
  test("chat_step.sends_to_chat: before chat is set up the step links to set it up on unset.cc and offers no Continue", async () => {
    const { did, cookie } = await atChatStep();
    const response = await get("/welcome/chat", cookie);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(SET_UP_LINK);
    expect(html).toContain("recovery key");
    expect(html).not.toContain('<form method="POST">');
    expect(asked).toEqual([`/set-up?did=${encodeURIComponent(did)}`]);
  });

  test("chat_step.getting_ready: while the chat account is not created yet the step says so and links nowhere", async () => {
    const { cookie } = await atChatStep({ chat: "pending" });
    const html = await (await get("/welcome/chat", cookie)).text();
    expect(html).not.toContain(SET_UP_LINK);
    expect(html).toContain("getting ready");
    expect(html).toContain('href="/welcome/chat"');
  });

  test("chat_step.continue_after_set_up: once a browser is set up the step offers Continue, which finishes signup", async () => {
    const { did, cookie } = await atChatStep();
    answer = SET_UP;
    const html = await (await get("/welcome/chat", cookie)).text();
    expect(html).toContain('<form method="POST">');
    expect(html).not.toContain(SET_UP_LINK);
    expect(location(await post("/welcome/chat", cookie))).toBe("/verify-email");
    expect(await onboardingOf(did)).toBe("done");
  });

  test("chat_step.continue_confirmed_email: with a confirmed email Continue goes to the member's page", async () => {
    const { cookie } = await atChatStep({ emailConfirmed: true });
    answer = SET_UP;
    expect(location(await post("/welcome/chat", cookie))).toBe("/me");
  });

  test.each([
    ["not set up", NOT_SET_UP],
    ["down", { status: 503, body: '{"error":"chat.unavailable"}', delayMs: 0 }],
    ["slow", { status: 200, body: '{"setUp":true}', delayMs: 3000 }],
    ["odd", { status: 200, body: '{"setUp":"true"}', delayMs: 0 }],
    ["not json", { status: 200, body: "true", delayMs: 0 }],
  ])(
    "chat_step.continue_refused_%s: Continue does not finish signup and the step is shown again",
    async (_name, told) => {
      const { did, cookie } = await atChatStep();
      answer = told;
      expect(location(await post("/welcome/chat", cookie))).toBe("/welcome/chat");
      expect(await onboardingOf(did)).toBe("chat");
    },
  );

  test("chat_step.denied: a visitor signs in first, a cross-site Continue is refused, and neither asks the door", async () => {
    expect(location(await get("/welcome/chat"))).toMatch(/^\/login/);
    const { did, cookie } = await atChatStep();
    answer = SET_UP;
    const crossSite = await post("/welcome/chat", cookie, "https://evil.example");
    expect(crossSite.status).toBe(403);
    expect(await onboardingOf(did)).toBe("chat");
    expect(asked).toEqual([]);
  });

  test("chat_step.finished_member: a member who already finished is sent on and the door is not asked", async () => {
    const { did, cookie } = await atChatStep({ emailConfirmed: true });
    expect(await accounts.finishChat(did, deadline())).toBe(true);
    expect(location(await get("/welcome/chat", cookie))).toBe("/me");
    expect(asked).toEqual([]);
  });
});
