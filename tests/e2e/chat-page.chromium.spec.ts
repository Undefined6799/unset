// The chat page end to end (build step 7; ADR 0088), against the stack in fixtures/chat-stack.ts: the built page, the
// door, real Postgres as `chat_auth`, real chat-admin, with MAS and the homeserver the only stand-ins.
// What it proves: a load with no session runs the hop; the page redeems in its own context and, for an account with no
// keys yet, shows "Save your recovery key" (build step 8; ADR 0083 decision 2, ADR 0089): the key in a field a
// password manager can save, a Download built in the page, a check of its last characters, and only then the vault;
// a second browser of the account is locked, refuses a wrong key plainly and unlocks with the saved one; the key is
// never in a request body except as the page's own encryption makes it, nor in storage;
// after redeem neither web storage, cookies, IndexedDB nor the address holds the token, the lock key or the ticket;
// the page runs under its CSP with no violation; renewal re-runs the hop for the same device and lock key; a token the
// server stops taking right after sign-in shows a fixed code instead of looping; axe passes in both themes.
// Conversations (build step 9): a request shows who asks and whether the room is encrypted, and Accept joins and records
// it as direct; the start route makes exactly the room our server accepts, keeps the composer off until the other
// person has joined, then sends only ciphertext; a second start finds the same room; a bad chat ID starts nothing.
// The count (build step 10; ADR 0090): once ready the page registers one pusher with the door's key, and a refused
// pusher leaves chat as it is. Signup's chat step (book P6.17): opened at /welcome, the page saves the key on two
// cards, registers the pusher, then offers the way back to unset.sh through the door.
// Chromium only, by its name (playwright.config.ts ignores *chromium.spec.ts for Firefox and WebKit): the CSP check
// reads Chromium's console wording, as csp.spec.ts does.
import { text as readText } from "node:stream/consumers";
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
let contexts: BrowserContext[] = [];

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
  await Promise.all(contexts.map((c) => c.close()));
  contexts = [];
  await stack.close();
});

type Redeemed = {
  accessToken: string;
  storageKey: string;
  deviceId: string;
  userId: string;
  newDevice: boolean;
  ticket: string;
};

/** A page that records each redeem (the ticket it sent, the session it got) and every CSP complaint. */
async function open(browser: Browser, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({
    proxy: { server: stack.proxy },
    ignoreHTTPSErrors: true,
    colorScheme,
    acceptDownloads: true,
  });
  contexts.push(context);
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

test("chat_page.signs_in_setup: a load with no session hops, redeems in the page and asks to save the key", async ({
  browser,
}) => {
  const { page, redeems, problems } = await open(browser);
  await page.goto("https://unset.cc/");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("save_key");
  expect(await page.locator("h1").textContent()).toBe("Save your recovery key");
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
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("save_key");
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
  // The reload left setup half-way on this browser, which holds the keys: it is asked again (ADR 0089 decision 2).
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("save_key");
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

/** Runs setup in `page` to the end and returns the key it showed: the first card shows it, the second checks its end. */
async function saveKey(page: Page): Promise<string> {
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("save_key");
  const key = await page.locator("#recovery-key").inputValue();
  await page.getByRole("button", { name: "I have saved my key" }).click();
  await page.locator("#key-end").fill(key.replaceAll(" ", "").slice(-4));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("ready");
  return key;
}

/** The forms the key could take in a body or a store: as shown, without spaces, and its 32 bytes in base64 and hex. */
function keyForms(key: string): string[] {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const c of key.replaceAll(" ", "")) value = value * 58n + BigInt(ALPHABET.indexOf(c));
  const bytes = Buffer.from(value.toString(16).padStart(70, "0"), "hex").subarray(2, 34);
  return [
    key,
    key.replaceAll(" ", ""),
    bytes.toString("base64").replace(/=+$/, ""),
    bytes.toString("base64url"),
    bytes.toString("hex"),
  ];
}

test("chat_page.setup_saves_key: the key is shown to save and download, checked, then stored; it is never sent or kept", async ({
  browser,
}) => {
  const { page, problems } = await open(browser);
  const bodies: string[] = [];
  page.on("request", (r) => bodies.push(r.postData() ?? ""));
  await page.goto("https://unset.cc/");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("save_key");
  const field = page.locator("#recovery-key");
  const key = await field.inputValue();
  expect(key).toMatch(/^(\S{4} ){11}\S{4}$/);
  expect([await field.getAttribute("autocomplete"), await field.getAttribute("readonly")]).toEqual([
    "new-password",
    "",
  ]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("unset-chat-recovery-key.txt");
  // A stream, not download.path(): CI drives a browser server, and path() "throws when connected remotely"
  // (node_modules/playwright-core/types/types.d.ts, Download, 1.64.1).
  expect(await readText(await download.createReadStream())).toContain(key);
  // Nothing is stored before the check passes.
  const vaultWrites = () =>
    stack.homeserver.seen.filter((c) => c.method === "PUT" && /account_data\/m\.secret_storage/.test(c.url)).length;
  // The second card hides the key and asks for its end; "Show my key again" goes back to it, the same key.
  await page.getByRole("button", { name: "I have saved my key" }).click();
  await expect(page.locator("#recovery-key")).toHaveCount(0);
  expect(await page.content()).not.toContain(key);
  await page.getByRole("button", { name: "Show my key again" }).click();
  expect(await page.locator("#recovery-key").inputValue()).toBe(key);
  await page.getByRole("button", { name: "I have saved my key" }).click();
  await page.locator("#key-end").fill("xxxx");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#key-end-wrong")).toBeVisible();
  expect([await state(page), vaultWrites()]).toEqual(["save_key", 0]);
  await page.locator("#key-end").fill(key.replaceAll(" ", "").slice(-4));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("ready");
  expect(vaultWrites()).toBeGreaterThan(0);
  expect(await page.content()).not.toContain(key);
  const forms = keyForms(key);
  const sent = [...bodies, ...stack.homeserver.seen.map((c) => c.body)];
  expect(sent.filter((b) => forms.some((f) => b.includes(f)))).toEqual([]);
  const { text } = await kept(page);
  expect(forms.filter((f) => text.includes(f))).toEqual([]);
  expect(problems).toEqual([]);
});

test("chat_page.second_browser_unlocks: another browser is locked, refuses a wrong key plainly, opens with the key", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const first = await open(browser);
  await first.page.goto("https://unset.cc/");
  const key = await saveKey(first.page);
  const second = await open(browser);
  await second.page.goto("https://unset.cc/");
  await expect.poll(() => state(second.page), { timeout: 30_000 }).toBe("locked");
  expect(await second.page.locator("h1").textContent()).toBe("Unlock your messages");
  const field = second.page.locator("#unlock-key");
  expect(await field.getAttribute("autocomplete")).toBe("current-password");
  // A key with its first group changed (its check digit no longer holds), then the right one.
  const other = key.replace(/^\S{4}/, "EsTb");
  await field.fill(other);
  await second.page.getByRole("button", { name: "Unlock" }).click();
  await expect(second.page.getByRole("alert")).toContainText("That is not your recovery key");
  expect(await state(second.page)).toBe("locked");
  await field.fill(key);
  await second.page.getByRole("button", { name: "Unlock" }).click();
  await expect.poll(() => state(second.page), { timeout: 30_000 }).toBe("ready");
  expect(second.problems).toEqual([]);
});

test("chat_page.one_tab: a second tab waits without signing in; Use here moves chat to it and stops the first", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const first = await open(browser);
  await first.page.goto("https://unset.cc/");
  await saveKey(first.page);
  // A second tab of the same browser: same cookies, same key store.
  const second = await first.context.newPage();
  const hops: string[] = [];
  second.on(
    "request",
    (r) => ["/sign-in", "/sign-in/redeem"].includes(new URL(r.url()).pathname) && hops.push(r.url()),
  );

  await second.goto("https://unset.cc/");
  await expect.poll(() => state(second), { timeout: 30_000 }).toBe("open_elsewhere");
  expect(await second.locator("h1").textContent()).toBe("Your messages are open in another tab");
  // It neither hopped nor redeemed, so it never held a token or the lock key its store opens with.
  expect(hops).toEqual([]);
  expect(first.redeems).toHaveLength(1);
  expect(await state(first.page)).toBe("ready");
  await second.getByRole("button", { name: "Use here" }).click();
  await expect.poll(() => state(first.page), { timeout: 30_000 }).toBe("open_elsewhere");
  await expect.poll(() => state(second), { timeout: 30_000 }).toBe("ready");
  expect(hops.some((u) => u.includes("/sign-in?return="))).toBe(true);
  // The first tab stays stopped: it does not hop back, so the two never take turns.
  const before = first.redeems.length;
  await second.waitForTimeout(2_000);
  expect(first.redeems.length).toBe(before);
  expect(await state(first.page)).toBe("open_elsewhere");
});

/** The IndexedDB databases this origin holds for chat accounts (the SDK's two per account, client.ts storePrefix). */
const chatStores = async (page: Page) => (await kept(page)).names.filter((n) => n.startsWith("unset-chat:"));

test("chat_page.unset_log_out: unset.sh's Log out stops the open tab, ends the device and leaves no store", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page, redeems, problems } = await open(browser);
  await page.goto("https://unset.cc/");
  await saveKey(page);
  expect(await chatStores(page)).toHaveLength(2);
  // Log out from another tab of the same browser, as from an unset.sh page there; chat stays open in the first.
  const other = await context.newPage();
  const doorCalls: string[] = [];
  other.on("request", (r) => r.method() === "POST" && doorCalls.push(`${new URL(r.url()).pathname} ${r.postData()}`));
  other.on("pageerror", (e) => problems.push(e.message));
  await other.goto("https://unset.sh/logout");
  await other.waitForURL("https://unset.sh/signed-out", { timeout: 60_000 });
  // The door sends the tab to web's bounce, whose own navigation is same-site, so the Strict issuer cookie arrives and
  // the page links the member's own sign-in server (RFC 6265bis-22 section 5.2, 5.2.1).
  await expect(other.locator("#account")).toHaveText("your sign-in server (pds.example)");
  // The open tab lost the lock and stopped; the store went with the device.
  expect(await state(page)).toBe("open_elsewhere");
  expect(doorCalls.map((c) => c.split(" ")[0])).toEqual(["/sign-out/redeem", "/sign-out"]);
  expect(doorCalls[1]).toBe(`/sign-out ${JSON.stringify({ deviceId: redeems[0]?.deviceId })}`);
  expect(await chatStores(page)).toEqual([]);
  // The next sign-in is a new device with a new lock key; the account is set up, so this browser is locked.
  const next = other.waitForResponse((r) => r.url().endsWith("/sign-in/redeem"));
  await other.goto("https://unset.cc/");
  const fresh = (await (await next).json()) as Omit<Redeemed, "ticket">;
  await expect.poll(() => state(other), { timeout: 30_000 }).toBe("locked");
  expect(fresh.newDevice).toBe(true);
  expect(fresh.deviceId).not.toBe(redeems[0]?.deviceId);
  expect(fresh.storageKey).not.toBe(redeems[0]?.storageKey);
  expect(problems).toEqual([]);
});

test("chat_page.strict_needs_the_bounce: a navigation started on unset.cc carries no Strict unset.sh cookie", async ({
  browser,
}) => {
  // The control for chat_page.unset_log_out: the cookie is in the jar, but a page on unset.cc going straight to
  // /signed-out is cross-site (its client's site for cookies is unset.cc), so the Strict cookie stays home.
  const { context, page } = await open(browser);
  const value = Buffer.from("https://pds.example").toString("base64url");
  await context.addCookies([
    {
      name: "__Host-signed_out_issuer",
      value,
      url: "https://unset.sh/",
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.goto("https://unset.sh/signed-out");
  await expect(page.locator("#account")).toHaveText("your sign-in server (pds.example)");
  await page.goto("https://unset.cc/health");
  await page.evaluate(() =>
    (globalThis as unknown as { location: { assign(u: string): void } }).location.assign("https://unset.sh/signed-out"),
  );
  await page.waitForURL("https://unset.sh/signed-out");
  await expect(page.locator("#account")).toHaveText("Your account on our server");
});

test("chat_page.forged_sign_out: a sign-out link without a good ticket stops nothing and deletes nothing", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page } = await open(browser);
  await page.goto("https://unset.cc/");
  await saveKey(page);
  const other = await context.newPage();
  await other.goto("https://unset.cc/sign-out/return#ticket=not-a-ticket");
  await other.waitForURL("https://unset.sh/signed-out", { timeout: 30_000 });
  await other.waitForTimeout(1_000);
  expect(await state(page)).toBe("ready");
  expect(await chatStores(page)).toHaveLength(2);
});

test("chat_page.ended_device_wiped: a store left by a device ended elsewhere is wiped, and the new device opens", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, redeems } = await open(browser);
  await page.goto("https://unset.cc/");
  await saveKey(page);
  stack.endAllSessions();
  await page.goto("https://unset.cc/");
  // The door finds the device ended and drops its entry; the next sign-in makes a new device for this browser.
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("error");
  expect(await page.locator("main").textContent()).toContain("chat.device_ended");
  await page.getByRole("link", { name: "Try again" }).click();
  // Without the wipe the old store, sealed with a lock key that no longer exists, would refuse to open
  // (chat.keys_unavailable).
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("locked");
  expect(redeems.map((r) => r.newDevice)).toEqual([true, true]);
  expect(await chatStores(page)).toHaveLength(2);
});

test("chat_page.unlock_before_setup_done: a browser whose account is half set up elsewhere is told so", async ({
  browser,
}) => {
  const first = await open(browser);
  await first.page.goto("https://unset.cc/");
  await expect.poll(() => state(first.page), { timeout: 30_000 }).toBe("save_key");
  const key = await first.page.locator("#recovery-key").inputValue();
  const second = await open(browser);
  await second.page.goto("https://unset.cc/");
  await expect.poll(() => state(second.page), { timeout: 30_000 }).toBe("locked");
  await second.page.locator("#unlock-key").fill(key);
  await second.page.getByRole("button", { name: "Unlock" }).click();
  await expect(second.page.getByRole("alert")).toContainText("Setting up is not finished yet");
});

for (const scheme of ["light", "dark"] as const) {
  test(`chat_page.axe_${scheme}: the save, check and unlock cards have no accessibility violation`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const first = await open(browser, scheme);
    await first.page.goto("https://unset.cc/");
    await expect.poll(() => state(first.page), { timeout: 30_000 }).toBe("save_key");
    expect((await new AxeBuilder({ page: first.page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await first.page.getByRole("button", { name: "I have saved my key" }).click();
    await expect(first.page.locator("#key-end")).toBeVisible();
    expect((await new AxeBuilder({ page: first.page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await first.page.getByRole("button", { name: "Show my key again" }).click();
    await saveKey(first.page);
    const second = await open(browser, scheme);
    await second.page.goto("https://unset.cc/");
    await expect.poll(() => state(second.page), { timeout: 30_000 }).toBe("locked");
    await second.page.locator("#unlock-key").fill("not a key");
    await second.page.getByRole("button", { name: "Unlock" }).click();
    await expect(second.page.getByRole("alert")).toBeVisible();
    expect((await new AxeBuilder({ page: second.page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}

const THEM = `@u${"b".repeat(20)}:staging.unset.cc`;
const CY = `@u${"c".repeat(20)}:staging.unset.cc`;
const conversation = (page: Page) => page.locator("[data-screen=conversation]");
/** The account's m.direct as the page last wrote it. */
const lastDirect = () => {
  const writes = stack.homeserver.seen.filter((c) => c.method === "PUT" && c.url.includes("/account_data/m.direct"));
  return JSON.parse(writes.at(-1)?.body ?? "null") as unknown;
};

test("chat_page.request_accept: a request names who asks and marks the room; Accept joins and records it", async ({
  browser,
}) => {
  const { page, redeems, problems } = await open(browser);
  await page.goto("https://unset.cc/");
  await saveKey(page);
  const me = redeems[0]?.userId ?? "";
  const roomId = stack.homeserver.rooms.invite(me, THEM, "Bea <i>B</i>", "encrypted");
  stack.homeserver.rooms.invite(me, CY, "Cy", "plain");
  const request = page.locator(`[data-request="${THEM}"]`);
  await expect(request).toContainText("Bea <i>B</i> wants to talk", { timeout: 30_000 });
  expect(await request.locator("i").count()).toBe(0);
  await expect(request.locator("[data-mark]")).toHaveAttribute("data-mark", "encrypted");
  await expect(page.locator(`[data-request="${CY}"] [data-mark]`)).toHaveAttribute("data-mark", "not_encrypted");
  await request.getByRole("button", { name: "Accept" }).click();
  const talk = page.locator(`[data-conversation="${THEM}"]`);
  await expect(talk).toBeVisible({ timeout: 30_000 });
  expect(stack.homeserver.seen.filter((c) => c.method === "POST" && c.url.includes("/join/")).length).toBe(1);
  await expect.poll(lastDirect).toEqual({ [THEM]: [roomId] });
  await talk.click();
  await expect(conversation(page)).toHaveAttribute("data-composer", "on", { timeout: 30_000 });
  await page.locator("#message").fill("hi Bea");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(page).locator("ol")).toContainText("hi Bea");
  const { sent } = stack.homeserver.rooms;
  await expect.poll(() => sent.map((s) => s.type)).toEqual(["m.room.encrypted"]);
  expect(JSON.stringify(sent)).not.toContain("hi Bea");
  expect(problems).toEqual([]);
});

test("chat_page.start_with: the start route makes the room the server accepts; the composer waits for the join", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, problems } = await open(browser);
  await page.goto(`https://unset.cc/?with=${encodeURIComponent(THEM)}`);
  await saveKey(page);
  await expect(conversation(page)).toHaveAttribute("data-composer", "waiting_for_them", { timeout: 30_000 });
  expect(page.url()).toBe("https://unset.cc/");
  const { created, rooms, sent } = stack.homeserver.rooms;
  expect(created).toEqual([{ preset: "trusted_private_chat", is_direct: true, invite: [THEM] }]);
  const [roomId] = [...rooms.keys()];
  await expect.poll(lastDirect).toEqual({ [THEM]: [roomId] });
  await expect(conversation(page).locator("[data-mark]")).toHaveAttribute("data-mark", "encrypted");
  expect([
    await page.locator("#message").isDisabled(),
    await page.getByRole("button", { name: "Send" }).isDisabled(),
  ]).toEqual([true, true]);
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  stack.homeserver.rooms.join(roomId ?? "", THEM, "Bea");
  await expect(conversation(page)).toHaveAttribute("data-composer", "on", { timeout: 30_000 });
  await page.locator("#message").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => sent.map((s) => s.type)).toEqual(["m.room.encrypted"]);
  // A second start with the same person opens the same conversation.
  await page.goto(`https://unset.cc/?with=${encodeURIComponent(THEM)}`);
  await expect(conversation(page)).toHaveAttribute("data-composer", "on", { timeout: 30_000 });
  expect(created).toHaveLength(1);
  expect(problems).toEqual([]);
});

test("chat_page.start_bad_id: a chat ID that is not one of ours starts nothing and says so", async ({ browser }) => {
  const { page } = await open(browser);
  await page.goto(`https://unset.cc/?with=${encodeURIComponent("@ubbbbbbbbbbbbbbbbbbbb:elsewhere.example")}`);
  await saveKey(page);
  await expect(page.getByRole("alert")).toContainText("That chat ID is not one we know.");
  expect(stack.homeserver.rooms.created).toEqual([]);
});

test("chat_page.reload_cached_sync: a set-up browser reloaded within Synapse's sync cache is not asked to set up again", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, problems } = await open(browser);
  const states: (string | null)[] = [];
  await page.goto("https://unset.cc/");
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("save_key");
  // The initial /sync this device made before its vault existed, which Synapse hands back on a quick reload.
  const before = stack.homeserver.now();
  await saveKey(page);
  const vaultWrites = () =>
    stack.homeserver.seen.filter((c) => c.method === "PUT" && /account_data\/m\.secret_storage/.test(c.url)).length;
  const written = vaultWrites();
  stack.homeserver.state.cachedInitialAt = before;
  await page.goto("https://unset.cc/");
  const watch = setInterval(async () => states.push(await state(page).catch(() => null)), 100);
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("ready");
  await page.waitForTimeout(2000);
  clearInterval(watch);
  expect(states.filter((s) => s === "save_key" || s === "setting_up")).toEqual([]);
  expect(await state(page)).toBe("ready");
  expect(vaultWrites()).toBe(written);
  expect(problems).toEqual([]);
});

test("chat_page.pusher_once: once ready the page registers one pusher with the door's key, and its count reaches web", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, problems } = await open(browser);
  await page.goto("https://unset.cc/");
  await saveKey(page);
  await expect.poll(() => stack.homeserver.pushers.length, { timeout: 30_000 }).toBe(1);
  const [pusher] = stack.homeserver.pushers;
  expect(pusher).toMatchObject({
    kind: "http",
    app_id: "sh.unset.count",
    append: false,
    data: { url: "http://chat-auth:8091/_matrix/push/v1/notify", format: "event_id_only" },
  });
  // What Synapse would post for that pusher reaches the count web reads (ADR 0090 decision 2).
  const notified = await stack.notify(String(pusher?.pushkey), 3);
  expect(notified).toEqual({ rejected: [] });
  expect(await stack.count()).toBe(3);
  // A later trust change repaints the page but registers nothing more.
  await page.waitForTimeout(1000);
  expect(stack.homeserver.pushers).toHaveLength(1);
  expect(problems).toEqual([]);
});

test("chat_page.signup_step: from signup's chat step the page saves the key, registers the pusher, then goes back", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, problems } = await open(browser);
  await page.goto("https://unset.cc/welcome");
  await saveKey(page);
  // Ready is said only once the pusher is registered, so the way back never comes before the count works.
  expect(stack.homeserver.pushers).toHaveLength(1);
  expect(new URL(page.url()).pathname).toBe("/welcome");
  await expect(page.getByRole("heading", { name: "Your messages are set up" })).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();
  await page.waitForURL("https://unset.sh/welcome/chat");
  expect(problems).toEqual([]);
});

test("chat_page.pusher_refused: a homeserver that refuses the pusher leaves chat ready", async ({ browser }) => {
  const { page, problems } = await open(browser);
  stack.homeserver.state.refusePushers = true;
  await page.goto("https://unset.cc/");
  await saveKey(page);
  await expect
    .poll(() => stack.homeserver.seen.some((c) => c.url.includes("/pushers/set")), { timeout: 30_000 })
    .toBe(true);
  expect(await state(page)).toBe("ready");
  expect(problems).toEqual([]);
});

test("chat_page.message_link: /dm/<did> hops, asks the door for the chat ID and starts the conversation", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const did = `did:plc:${"m".repeat(24)}`;
  db.addContact(did, `u${"b".repeat(20)}`);
  const { page, problems } = await open(browser);
  await page.goto(`https://unset.cc/dm/${did}`);
  await saveKey(page);
  await expect(conversation(page)).toHaveAttribute("data-composer", "waiting_for_them", { timeout: 30_000 });
  expect(page.url()).toBe("https://unset.cc/");
  expect(stack.homeserver.rooms.created).toEqual([{ preset: "trusted_private_chat", is_direct: true, invite: [THEM] }]);
  expect(problems).toEqual([]);
});

test("chat_page.message_link_missing: a member the door does not find starts nothing and says only that", async ({
  browser,
}) => {
  const { page } = await open(browser);
  await page.goto(`https://unset.cc/dm/did:plc:${"n".repeat(24)}`);
  await saveKey(page);
  await expect(page.getByRole("alert")).toContainText("That chat ID is not one we know.");
  expect(page.url()).toBe("https://unset.cc/");
  expect(stack.homeserver.rooms.created).toEqual([]);
});
