// The chat page end to end (build step 7; ADR 0088), against the stack in fixtures/chat-stack.ts: the built page, the
// door, real Postgres as `chat_auth`, real chat-admin, with MAS and the homeserver the only stand-ins.
// What it proves: a load with no session runs the hop; the page redeems in its own context and shows the locked state;
// after redeem neither web storage, cookies, IndexedDB nor the address holds the token, the lock key or the ticket;
// the page runs under its CSP with no violation; renewal re-runs the hop for the same device and lock key; a token the
// server stops taking right after sign-in shows a fixed code instead of looping; axe passes in both themes.
// Chromium only, by its name (playwright.config.ts ignores *chromium.spec.ts for Firefox and WebKit): the CSP check
// reads Chromium's console wording, as csp.spec.ts does.
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  buildChatPage,
  type ChatDatabase,
  type ChatStack,
  scratch,
  startChatDatabase,
  startChatStack,
  stopChatDatabase,
} from "./fixtures/chat-stack.ts";

const dir = scratch();
const pageDir = `${dir}/page`;
let db: ChatDatabase;
let stack: ChatStack;
let context: BrowserContext | undefined;

test.beforeAll(async () => {
  // The hook's own budget (playwright.dev/docs/api/class-test#test-set-timeout, 1.64.1): a Vite build and a Postgres
  // start; tests/support/postgres.ts waits up to 90 s for init.
  test.setTimeout(240_000);
  buildChatPage(pageDir);
  db = await startChatDatabase();
});

test.afterAll(() => stopChatDatabase());

test.beforeEach(async () => {
  stack = await startChatStack(db, pageDir, dir);
});

test.afterEach(async () => {
  await context?.close();
  context = undefined;
  await stack.close();
});

type Redeemed = { accessToken: string; storageKey: string; deviceId: string; ticket: string };

/** A page that records each redeem (the ticket it sent, the session it got) and every CSP complaint. */
async function open(browser: Browser, colorScheme: "light" | "dark" = "light") {
  context = await browser.newContext({ proxy: { server: stack.proxy }, ignoreHTTPSErrors: true, colorScheme });
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

const state = (page: Page) => page.locator("main").getAttribute("data-state");

/** Everything this origin keeps in the browser, as text: web storage, readable cookies, and every IndexedDB value. */
const kept = (page: Page) =>
  page.evaluate(async () => {
    // The browser globals the probe reads, typed by shape: the tests program has no DOM lib.
    type Request<T> = { result: T; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null };
    type Db = {
      objectStoreNames: ArrayLike<string>;
      transaction(store: string): { objectStore(store: string): { getAll(): Request<unknown[]> } };
      close(): void;
    };
    const { localStorage, sessionStorage, document, indexedDB } = globalThis as unknown as {
      localStorage: Record<string, string>;
      sessionStorage: Record<string, string>;
      document: { cookie: string };
      indexedDB: { databases(): Promise<{ name?: string }[]>; open(name: string): Request<Db> };
    };
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
      const db = await new Promise<Db>((ok, no) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const all = db.transaction(store).objectStore(store).getAll();
        await new Promise<void>((ok) => {
          all.onsuccess = () => ok();
        });
        out.push(show(all.result));
      }
      db.close();
    }
    return { text: out.join("\n"), names };
  });

const hex = (base64url: string) => Buffer.from(base64url, "base64url").toString("hex");

test("chat_page.signs_in_locked: a load with no session hops, redeems in the page and shows the locked card", async ({
  browser,
}) => {
  const { page, redeems, problems } = await open(browser);
  await page.goto("https://unset.cc/");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("locked");
  expect(await page.locator("h1").textContent()).toBe("Unlock your messages");
  expect(page.url()).toBe("https://unset.cc/");
  expect(redeems).toHaveLength(1);
  expect(problems).toEqual([]);
  // The client used the session it was handed, as a header, never in a query.
  const calls = stack.homeserver.seen.filter((c) => c.url !== "/_matrix/client/versions");
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => c.auth === `Bearer ${redeems[0]?.accessToken}`)).toBe(true);
  expect(stack.homeserver.seen.some((c) => c.url.includes("access_token"))).toBe(false);
});

test("chat_page.nothing_kept: after redeem no token, lock key or ticket is in storage, cookies or the address", async ({
  browser,
}) => {
  const { context, page, redeems } = await open(browser);
  await page.goto("https://unset.cc/");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("locked");
  const [one] = redeems;
  if (one === undefined) throw new Error("no redeem");
  const { text, names } = await kept(page);
  const cookies = JSON.stringify(await context.cookies());
  const address = await page.evaluate(() => {
    const view = globalThis as unknown as { location: { href: string }; history: { state: unknown } };
    return `${view.location.href} ${String(view.history.state)}`;
  });
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
});

test("chat_page.renews: before the token ends the hop runs again, for the same device and lock key", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, redeems, problems } = await open(browser);
  await page.goto("https://unset.cc/");
  // sessionTtl 75 s: the page renews a minute before the end, about 15 s after signing in.
  await expect.poll(() => redeems.length, { timeout: 40_000 }).toBe(2);
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("locked");
  const [first, second] = redeems;
  expect(second?.deviceId).toBe(first?.deviceId);
  expect(second?.storageKey).toBe(first?.storageKey);
  expect(second?.accessToken).not.toBe(first?.accessToken);
  expect(problems).toEqual([]);
});

test("chat_page.refused_soon: a token refused right after sign-in shows a fixed code and does not loop", async ({
  browser,
}) => {
  const { page, redeems } = await open(browser);
  stack.homeserver.state.refuse = true;
  await page.goto("https://unset.cc/");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("error");
  expect(await page.locator("main").textContent()).toContain("chat.session_refused");
  expect(redeems).toHaveLength(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`chat_page.axe_${scheme}: the locked card has no accessibility violation`, async ({ browser }) => {
    const { page } = await open(browser, scheme);
    await page.goto("https://unset.cc/");
    await expect.poll(() => state(page), { timeout: 30_000 }).toBe("locked");
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
}
