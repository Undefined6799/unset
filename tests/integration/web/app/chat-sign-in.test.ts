// Build step 5 (ADR 0093 decision 3; security pass finding 8): GET /chat/sign-in on the built web server, the unset.sh
// half of the unset.cc sign-in hop. Postgres as `web` (TE-2). The door is not built yet; its origin is config, and
// these tests read what web sends it: a 303 to the door's return path with the ticket in the fragment, which no server
// and no Referer sees. Only a signed-in, onboarded member whose chat account exists gets one, or a member at signup's
// chat step whose chat is not set up yet (review N6): the door's count port, a loopback stand-in here (TE-1), says so.
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http"; // guard-allow: egress a loopback stand-in for the door's count port only
import { tmpdir } from "node:os";
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
import { canonicalize } from "@unset/shared-admin-envelope";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { chatAccountsOf } from "../../../support/chat-accounts.ts";
import { buildOnce, clientAddress, PDS_HOST, type RunningWeb, startWeb } from "../built-server.ts";
import { readyMember } from "../members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-chat-test",
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
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 5).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const PDS = `https://${PDS_HOST}`;
const DOOR = "https://staging.unset.cc";
const STATE = "St4te-of-the-door_0123456789abcdefghijklmno";

// web's chat key, made here so the test can check the ticket's signature with its public half.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keyDir = mkdtempSync(join(tmpdir(), "web-chat-key-"));
writeFileSync(join(keyDir, "key"), privateKey.export({ type: "pkcs8", format: "pem" }) as string);

let dids = 0;
function nextDid(): Did {
  dids += 1;
  const parsed = parseDid(`did:plc:${"m".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}`);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
}

/** A signed-in member: onboarded with a confirmed email unless `stage` is "new"; with a created chat account if `chat`. */
async function signedIn(options: { stage?: "ready" | "new" | "chat"; chat?: boolean } = {}) {
  const did = nextDid();
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
  if (options.stage === "chat") await atChatStep(did);
  else if (options.stage !== "new") await readyMember(pool, did, true);
  if (options.chat !== false && options.stage !== "new") {
    // What the queued job writes once chat-admin has created the account.
    await withClient(pool, null, (db) => db.query("UPDATE app.chat_account SET state = 'ready' WHERE did = $1", [did]));
  }
  return { did, cookie: `__Host-sid=${created.cookieValue}`, idHash: created.idHash };
}

/** Adult and terms accepted, the chat step not finished, as a new member is when the step sends them to unset.cc. */
async function atChatStep(did: Did) {
  const accounts = createAccountRepository(pool, {
    recordUnderageBlock: async () => {
      throw new Error("never blocks");
    },
    chatAccounts: chatAccountsOf(pool),
  });
  await accounts.confirmAdult(did, AbortSignal.timeout(5000));
  expect(await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, AbortSignal.timeout(5000))).toBe("chat");
}

// The door's count port as told: a status and a body for /set-up?did=.
let answer: { status: number; body: string };
const door: Server = createServer((_request, response) =>
  response.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body),
);
const NOT_SET_UP = { status: 200, body: '{"setUp":false}' };

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  await new Promise<void>((done) => door.listen(0, "127.0.0.1", done));
  const address = door.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  web = await startWeb(pg, {
    CHAT_DOOR_ORIGIN: DOOR,
    CHAT_ADMIN_WEB_KEY_FILE: join(keyDir, "key"),
    CHAT_COUNT_URL: `http://127.0.0.1:${port}`,
  });
}, 120_000);
beforeEach(() => {
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
const signInPath = (state = STATE) => `/chat/sign-in?${new URLSearchParams({ state })}`;

describe("GET /chat/sign-in", () => {
  test("chat.sign_in_requires_session: a visitor goes to sign in, and no ticket is made", async () => {
    const response = await get(signInPath());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fchat%2Fsign-in");
  });

  test("chat.sign_in_requires_onboarding: a member who has not onboarded gets no ticket", async () => {
    const { cookie } = await signedIn({ stage: "new" });
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location") ?? "").not.toContain(DOOR);
  });

  test("chat.sign_in_at_chat_step: a member setting up chat in signup gets a ticket, with no confirmed email yet", async () => {
    const { did, cookie } = await signedIn({ stage: "chat" });
    answer = NOT_SET_UP;
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(`${DOOR}/sign-in/return`);
    const ticket = new URLSearchParams(location.hash.slice(1)).get("ticket") ?? "";
    expect(JSON.parse(Buffer.from(ticket, "base64url").toString("utf8")).payload.did).toBe(did);
  });

  test("chat.sign_in_chat_step_set_up: a member at the chat step whose chat is set up gets no ticket until signup is done", async () => {
    const { cookie } = await signedIn({ stage: "chat" });
    answer = { status: 200, body: '{"setUp":true}' };
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/welcome/chat");
  });

  test("chat.sign_in_chat_step_door_down: with no clear answer from the door, a member at the chat step gets no ticket", async () => {
    const { cookie } = await signedIn({ stage: "chat" });
    answer = { status: 503, body: "" };
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/welcome/chat");
  });

  test("chat.sign_in_terms_step: a member who has not accepted the terms gets no ticket and goes to the terms", async () => {
    const { did, cookie } = await signedIn({ stage: "new" });
    const accounts = createAccountRepository(pool, {
      recordUnderageBlock: async () => {
        throw new Error("never blocks");
      },
      chatAccounts: chatAccountsOf(pool),
    });
    await accounts.confirmAdult(did, AbortSignal.timeout(5000));
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location") ?? "").toMatch(/^\/welcome/);
  });

  test("chat.sign_in_ticket: the member goes to the door with a ticket naming them, this session and the state", async () => {
    const { did, cookie, idHash } = await signedIn();
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}${location.search}`).toBe(`${DOOR}/sign-in/return`);
    const fragment = new URLSearchParams(location.hash.slice(1));
    expect([...fragment.keys()]).toEqual(["ticket"]);
    const envelope = JSON.parse(Buffer.from(fragment.get("ticket") ?? "", "base64url").toString("utf8"));
    const [{ chat_user: user }] = await withClient(pool, null, async (db) => {
      const { rows } = await db.query("SELECT chat_user FROM app.chat_account WHERE did = $1", [did]);
      return rows as [{ chat_user: string }];
    });
    const sid = createHash("sha256").update("unset.sh chat sign-in session v1\0").update(idHash).digest("base64url");
    expect(envelope.kid).toBe("web-test");
    expect(envelope.payload).toMatchObject({ aud: "chat-admin", verb: "session.mint", user, did, sid, state: STATE });
    expect(envelope.payload.exp - envelope.payload.iat).toBe(60);
    const signed = Buffer.from(canonicalize(envelope.payload));
    expect(verify(null, signed, publicKey, Buffer.from(envelope.sig, "base64url"))).toBe(true);
    // The ticket and the state never reach the log.
    const logged = JSON.stringify(web.logs());
    expect(logged).not.toContain(STATE);
    expect(logged).not.toContain(envelope.sig);
  });

  test("chat.sign_in_dock: the chat box's hop goes back to the box, the ticket only in the fragment", async () => {
    // ADR 0115: unset.sh's shell points the box's frame here; the ticket reaches the box on unset.cc by the redirect,
    // never unset.sh's script (chat box review D1).
    const { cookie } = await signedIn();
    const response = await get(`${signInPath()}&dock`, cookie);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}${location.search}`).toBe(`${DOOR}/?dock`);
    expect([...new URLSearchParams(location.hash.slice(1)).keys()]).toEqual(["ticket", "theme"]);
  });

  test("chat.sign_in_theme: the hop carries unset.sh's light / dark / device choice to the chat (Alex 2026-11-23)", async () => {
    const { cookie } = await signedIn();
    const theme = async (extra: string) => {
      const hash = new URL((await get(signInPath(), `${cookie}${extra}`)).headers.get("location") ?? "").hash;
      return new URLSearchParams(hash.slice(1)).getAll("theme");
    };
    expect(await theme("; __Host-theme=dark")).toEqual(["dark"]);
    expect(await theme("; __Host-theme=light")).toEqual(["light"]);
    expect(await theme("")).toEqual(["system"]);
    expect(await theme("; __Host-theme=evil")).toEqual(["system"]);
  });

  test("chat.sign_in_fresh_each_time: two hops get two tickets", async () => {
    const { cookie } = await signedIn();
    const jti = async () => {
      const hash = new URL((await get(signInPath(), cookie)).headers.get("location") ?? "").hash;
      const ticket = new URLSearchParams(hash.slice(1)).get("ticket") ?? "";
      return JSON.parse(Buffer.from(ticket, "base64url").toString("utf8")).payload.jti;
    };
    expect(await jti()).not.toBe(await jti());
  });

  test("chat.sign_in_restart: with no one-time value, as after signing in, the door starts the hop again", async () => {
    const { cookie } = await signedIn();
    const response = await get("/chat/sign-in", cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${DOOR}/`);
  });

  test.each([
    ["short", "abc"],
    ["padded", `${STATE.slice(0, 42)}=`],
  ])("chat.sign_in_bad_state_%s: a malformed one-time value is refused with no ticket", async (_name, state) => {
    const { cookie } = await signedIn();
    const response = await get(signInPath(state), cookie);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  test("chat.sign_in_two_states: two one-time values are refused", async () => {
    const { cookie } = await signedIn();
    const response = await get(`/chat/sign-in?state=${STATE}&state=${STATE}`, cookie);
    expect(response.status).toBe(400);
  });

  test("chat.sign_in_not_ready: a member whose chat account is not created yet gets no ticket", async () => {
    const { cookie } = await signedIn({ chat: false });
    const response = await get(signInPath(), cookie);
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
});
