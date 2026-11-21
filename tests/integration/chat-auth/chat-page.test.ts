// The chat page end to end in Chromium (build step 7; ADR 0088): apps/chat built by Vite, served by the door's own
// composition root against real Postgres as `chat_auth` (TE-2) and real chat-admin, with web's own client signing the
// ticket. The fakes are the unmanaged dependencies only (TE-1): MAS (chat-admin's harness) and the homeserver, which
// answers the client-server API calls a fresh client makes as Synapse would for an account with no keys yet
// (https://spec.matrix.org/v1.18/client-server-api/). One TLS listener plays the edge: unset.cc's /_matrix/client/* to
// the homeserver, the rest of unset.cc to the door, and unset.sh's /chat/sign-in to web's half of the hop.
// What it proves: a load with no session runs the hop; the page redeems in its own context and shows the locked state;
// after redeem neither web storage, cookies, IndexedDB nor the address holds the token, the lock key or the ticket;
// the page runs under its CSP with no violation; renewal re-runs the hop for the same device and lock key; a token the
// server stops taking right after sign-in shows a fixed code instead of looping.
/// <reference lib="dom" />
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress test fakes, loopback only
import { createServer } from "node:https"; // guard-allow: egress test edge, loopback listener only
import type { AddressInfo } from "node:net"; // guard-allow: egress test edge, a type only
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, chromium, type Page } from "@playwright/test";
import type { Did, Handle } from "@unset/domains-identity";
import { newChatUser, parseDoorState, sessionRef } from "@unset/domains-messaging";
import { createChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { loadConfig } from "@unset/shared-config";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { compose } from "../../../interfaces/chat-auth/compose.ts";
import { schema } from "../../../interfaces/chat-auth/config.ts";
import { loadChatPage } from "../../../interfaces/chat-auth/page.ts";
import { type FakeMas, fakeMas, startService } from "../chat-admin/harness.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const ROOT = join(import.meta.dirname, "../../..");
const ALICE = `did:plc:${"a".repeat(24)}` as Did;
const dir = mkdtempSync(join(tmpdir(), "chat-page-"));

function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o600);
  return path;
}

function certificate(): { key: Buffer; cert: Buffer } {
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", "-subj"].concat([
      "/CN=unset.cc",
      "-addext",
      "subjectAltName=DNS:unset.cc,DNS:unset.sh",
      "-keyout",
      join(dir, "tls.key"),
      "-out",
      join(dir, "tls.crt"),
    ]),
    { stdio: "ignore" },
  );
  return { key: readFileSync(join(dir, "tls.key")), cert: readFileSync(join(dir, "tls.crt")) };
}

/** The homeserver: a fresh account with no keys, a quiet sync, and every request kept for the checks. */
function fakeHomeserver() {
  const seen: { method: string; url: string; auth: string }[] = [];
  const state = { refuse: false };
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "https://unset.cc");
    seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization ?? "" });
    const path = url.pathname.replace(/^\/_matrix\/client\/(v3|v1|unstable)/, "");
    if (url.pathname === "/_matrix/client/versions") return reply(res, 200, { versions: ["v1.11", "v1.12"] });
    if (state.refuse) return reply(res, 401, { errcode: "M_UNKNOWN_TOKEN", error: "Token is not active" });
    if (path === "/sync") {
      const body = {
        next_batch: `s${seen.length}`,
        rooms: {},
        account_data: { events: [] },
        to_device: { events: [] },
      };
      const wait = url.searchParams.has("since") ? 300 : 0;
      setTimeout(() => reply(res, 200, body), wait);
      return;
    }
    if (path === "/capabilities") return reply(res, 200, { capabilities: {} });
    if (path === "/pushrules/") return reply(res, 200, { global: {} });
    if (/^\/user\/[^/]+\/filter$/.test(path)) return reply(res, 200, { filter_id: "f1" });
    if (path === "/keys/upload") return reply(res, 200, { one_time_key_counts: { signed_curve25519: 50 } });
    if (path === "/keys/query") return reply(res, 200, { device_keys: {}, failures: {} });
    return reply(res, 404, { errcode: "M_NOT_FOUND", error: "Not found" });
  };
  return { seen, state, handle };
}

let browser: Browser;
let mas: FakeMas;
let service: Awaited<ReturnType<typeof startService>>;
let door: Awaited<ReturnType<typeof compose>>;
let edge: ReturnType<typeof createServer>;
let homeserver: ReturnType<typeof fakeHomeserver>;
let port = 0;
const pageDir = join(dir, "page");

beforeAll(() => {
  execFileSync("npx", ["vite", "build", "apps/chat", "--outDir", pageDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}, 120_000);

beforeEach(async () => {
  mas = await fakeMas();
  service = await startService(mas, { sessionTtl: 75 });
  const env = {
    UNSET_ENV: "dev",
    UNSET_SERVICE: "chat-auth",
    UNSET_COMMIT: "c".repeat(40),
    LISTEN_PORT: "8090",
    PUBLIC_ORIGIN: "https://unset.cc",
    HTTP_ALLOWED_HOSTS: "unset.cc",
    TRUSTED_PROXY_MODE: "socket",
    WEB_ORIGIN: "https://unset.sh",
    PG_HOST: provided.host,
    PG_PORT: String(provided.port),
    PG_DATABASE: database,
    PG_USER: "chat_auth",
    PG_PASSWORD_FILE: file("pg", provided.roles.chat_auth.password),
    PG_SSLMODE: "disable",
    PG_POOL_MAX: "2",
    SEAL_KEYRING_FILE: file("seal", JSON.stringify({ active: "d1", keys: { d1: randomBytes(32).toString("base64") } })),
    NETGUARD_ALLOW_LOOPBACK: "true",
    CHAT_ADMIN_URL: service.base,
    CHAT_ADMIN_DOOR_KEY_FILE: file("door", String(service.door.privateKey.export({ type: "pkcs8", format: "pem" }))),
    CHAT_ADMIN_DOOR_KID: service.door.kid,
    CHAT_SERVER_NAME: "staging.unset.cc",
  };
  door = await compose(
    loadConfig(schema, env),
    { request: () => undefined, untrustedPeer: () => undefined },
    loadChatPage(pageDir),
  );
  const user = newChatUser((n) => randomBytes(n));
  const guard = createNetGuard({ internalHosts: [], allowLoopback: true, commit: "c".repeat(40) });
  const web = createChatAdminClient(guard, {
    origin: service.base,
    env: "dev",
    key: { kid: service.web.kid, privateKey: service.web.privateKey },
  });
  expect(await web.createAccount(user, "a.unset.name" as Handle)).toEqual({ kind: "created" });
  homeserver = fakeHomeserver();
  // web's half of the hop for the signed-in member (interfaces/web chat-sign-in.ts): sign, then back to the door.
  const signIn = async (req: IncomingMessage, res: ServerResponse) => {
    const state = parseDoorState(new URL(req.url ?? "/", "https://unset.sh").searchParams.get("state"));
    if (state === null) return res.writeHead(400).end();
    const ticket = await web.signTicket({ user, did: ALICE, sid: sessionRef(Buffer.alloc(32, 1)), state });
    res.writeHead(303, { location: `https://unset.cc/sign-in/return#${new URLSearchParams({ ticket })}` }).end();
  };
  edge = createServer(certificate(), (req, res) => {
    if (req.headers.host === "unset.sh") return void signIn(req, res);
    if (req.url?.startsWith("/_matrix/client/")) return homeserver.handle(req, res);
    door.listener(req, res);
  });
  await new Promise<void>((resolve) => edge.listen(0, "127.0.0.1", resolve));
  port = (edge.address() as AddressInfo).port;
  // Both names go to the edge above, never through a proxy the environment may set (Chromium reads *_proxy).
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP unset.cc 127.0.0.1:${port}, MAP unset.sh 127.0.0.1:${port}`],
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/proxy/i.test(name))),
  });
}, 60_000);

afterEach(async () => {
  await browser.close();
  await new Promise<void>((resolve) => edge.close(() => resolve()));
  await door.close();
  await service.close();
  await mas.close();
});

type Redeemed = { accessToken: string; storageKey: string; deviceId: string; ticket: string };

/** A page that records each redeem (the ticket it sent, the session it got) and every CSP complaint. */
async function open(colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme });
  const page = await context.newPage();
  const redeems: Redeemed[] = [];
  const problems: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("response", async (res) => {
    if (!res.url().endsWith("/sign-in/redeem") || res.status() !== 200) return;
    const ticket = (JSON.parse(res.request().postData() ?? "{}") as { ticket: string }).ticket;
    redeems.push({ ...((await res.json()) as Omit<Redeemed, "ticket">), ticket });
  });
  return { context, page, redeems, problems };
}

/** Everything this origin keeps in the browser, as text: web storage, readable cookies, and every IndexedDB value. */
const kept = (page: Page) =>
  page.evaluate(async () => {
    const show = (v: unknown): string =>
      JSON.stringify(v, (_k, x) =>
        x instanceof ArrayBuffer || ArrayBuffer.isView(x)
          ? Array.from(new Uint8Array(x instanceof ArrayBuffer ? x : x.buffer), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("")
          : x,
      );
    const out: string[] = [show({ ...localStorage }), show({ ...sessionStorage }), document.cookie];
    const names: string[] = [];
    for (const { name } of await indexedDB.databases()) {
      if (name === undefined) continue;
      names.push(name);
      const db = await new Promise<IDBDatabase>((ok, no) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const all = db.transaction(store).objectStore(store).getAll();
        await new Promise((ok) => (all.onsuccess = ok));
        out.push(show(all.result));
      }
      db.close();
    }
    return { text: out.join("\n"), names };
  });

const hex = (base64url: string) => Buffer.from(base64url, "base64url").toString("hex");

describe("the chat page", () => {
  test("chat_page.signs_in_locked: a load with no session hops, redeems in the page and shows the locked card", async () => {
    const { page, redeems, problems } = await open();
    await page.goto("https://unset.cc/");
    await expect.poll(() => page.locator("main").getAttribute("data-state"), { timeout: 30_000 }).toBe("locked");
    expect(await page.locator("h1").textContent()).toBe("Unlock your messages");
    expect(page.url()).toBe("https://unset.cc/");
    expect(redeems).toHaveLength(1);
    expect(problems).toEqual([]);
    // The client used the session it was handed, as a header, never in a query.
    const calls = homeserver.seen.filter((c) => c.url !== "/_matrix/client/versions");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.auth === `Bearer ${redeems[0]?.accessToken}`)).toBe(true);
    expect(homeserver.seen.some((c) => c.url.includes("access_token"))).toBe(false);
  }, 60_000);

  test("chat_page.nothing_kept: after redeem no token, lock key or ticket is in storage, cookies or the address", async () => {
    const { context, page, redeems } = await open();
    await page.goto("https://unset.cc/");
    await expect.poll(() => page.locator("main").getAttribute("data-state"), { timeout: 30_000 }).toBe("locked");
    const [one] = redeems;
    if (one === undefined) throw new Error("no redeem");
    const { text, names } = await kept(page);
    const cookies = JSON.stringify(await context.cookies());
    const address = await page.evaluate(() => `${location.href} ${history.state}`);
    for (const secret of [one.accessToken, one.storageKey, hex(one.storageKey), one.ticket]) {
      expect(text).not.toContain(secret);
      expect(cookies).not.toContain(secret);
      expect(address).not.toContain(secret);
    }
    expect(address).not.toContain("ticket");
    // The only databases are this account's key store, named by its prefix (apps/chat/matrix/client.ts storePrefix).
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.startsWith("unset-chat:@") && n.includes(":staging.unset.cc::matrix-sdk-crypto"))).toBe(
      true,
    );
  }, 60_000);

  test("chat_page.renews: before the token ends the hop runs again, for the same device and lock key", async () => {
    const { page, redeems, problems } = await open();
    await page.goto("https://unset.cc/");
    // sessionTtl 75 s: the page renews a minute before the end, about 15 s after signing in.
    await expect.poll(() => redeems.length, { timeout: 40_000 }).toBe(2);
    await expect.poll(() => page.locator("main").getAttribute("data-state"), { timeout: 30_000 }).toBe("locked");
    const [first, second] = redeems;
    expect(second?.deviceId).toBe(first?.deviceId);
    expect(second?.storageKey).toBe(first?.storageKey);
    expect(second?.accessToken).not.toBe(first?.accessToken);
    expect(problems).toEqual([]);
  }, 90_000);

  test("chat_page.refused_soon: a token refused right after sign-in shows a fixed code and does not loop", async () => {
    const { page, redeems } = await open();
    homeserver.state.refuse = true;
    await page.goto("https://unset.cc/");
    await expect.poll(() => page.locator("main").getAttribute("data-state"), { timeout: 30_000 }).toBe("error");
    expect(await page.locator("main").textContent()).toContain("chat.session_refused");
    expect(redeems).toHaveLength(1);
  }, 60_000);

  test.each(["light", "dark"] as const)(
    "chat_page.axe_%s: the locked card has no accessibility violation",
    async (scheme) => {
      const { page } = await open(scheme);
      await page.goto("https://unset.cc/");
      await expect.poll(() => page.locator("main").getAttribute("data-state"), { timeout: 30_000 }).toBe("locked");
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});
