// The whole minimal chat in real browsers (build step 11), against real Synapse and MAS (fixtures/chat-servers.ts): two
// members set up their keys, start a conversation, accept it and exchange end-to-end encrypted messages; a second
// browser unlocks with the recovery key and reads the history; unset.sh's Log out leaves nothing behind; suspension locks an open
// page and lifting it brings the same browser back with no unlock (ADR 0096 decisions 1 and 2); deletion ends the
// account and the other member keeps the conversation (decision 3). It also records the build plan's step-11
// unverified items as annotations: how fast a lock stops an open page and what the homeserver keeps of an erased
// account. Signup's chat step (book P6.17): opened at /welcome, a new member saves the key on two cards, the pusher is
// registered at Synapse, and the page then offers the way back to unset.sh.
// Chromium only, by its name (playwright.config.ts). Skipped, saying why, when the run is not pointed at the servers.
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { type RealServers, type RealStack, realServers, startRealStack } from "./fixtures/chat-servers.ts";
import {
  buildChatPage,
  type ChatDatabase,
  scratch,
  startChatDatabase,
  stopChatDatabase,
} from "./fixtures/chat-stack.ts";

const servers: RealServers | null = realServers();
// biome-ignore lint/suspicious/noSkippedTests: skipped only when the run names no Synapse and MAS, and says so
test.skip(servers === null, "set CHAT_E2E_* to a Synapse and MAS with our settings (fixtures/chat-servers.ts)");

const dir = scratch();
const pageDir = `${dir}/page`;
let db: ChatDatabase;
let stack: RealStack;
let contexts: BrowserContext[] = [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  buildChatPage(pageDir);
  db = await startChatDatabase();
});
test.afterAll(() => stopChatDatabase());
test.beforeEach(async () => {
  stack = await startRealStack(db, pageDir, dir, servers as RealServers);
});
test.afterEach(async () => {
  await Promise.all(contexts.map((c) => c.close()));
  contexts = [];
  await stack.close();
});

type Redeemed = { accessToken: string; deviceId: string; storageKey: string; newDevice: boolean };

/** A browser signed in as `handle` (web's hop reads the member from its cookie), recording each redeem. */
async function browserFor(browser: Browser, handle: string) {
  const context = await browser.newContext({ proxy: { server: stack.proxy }, ignoreHTTPSErrors: true });
  contexts.push(context);
  await context.addCookies([{ name: "member", value: handle, url: "https://unset.sh/", secure: true }]);
  const page = await context.newPage();
  const redeems: Redeemed[] = [];
  const problems: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("response", async (res) => {
    if (res.url().endsWith("/sign-in/redeem") && res.status() === 200) redeems.push((await res.json()) as Redeemed);
  });
  return { context, page, redeems, problems };
}

const state = (page: Page) => page.locator("main").getAttribute("data-state");
const conversation = (page: Page) => page.locator("[data-screen=conversation]");
const messages = (page: Page) => conversation(page).locator("ol");
const message = (page: Page, text: string) => messages(page).locator("li[data-message]", { hasText: text });
const unconfirmed = (page: Page) => messages(page).locator("[data-mark=unconfirmed]");

async function saveKey(page: Page): Promise<string> {
  await expect.poll(() => state(page), { timeout: 60_000 }).not.toBe("signing_in");
  if ((await state(page)) === "error") throw new Error(`chat page error: ${await page.locator("main").textContent()}`);
  await expect.poll(() => state(page), { timeout: 60_000 }).toBe("save_key");
  const key = await page.locator("#recovery-key").inputValue();
  await page.getByRole("button", { name: "I have saved my key" }).click();
  await page.locator("#key-end").fill(key.replaceAll(" ", "").slice(-4));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => state(page), { timeout: 60_000 }).toBe("ready");
  return key;
}

async function send(page: Page, text: string, composer: "on" | "pending" = "on"): Promise<void> {
  await expect(conversation(page)).toHaveAttribute("data-composer", composer, { timeout: 60_000 });
  await page.locator("#message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(messages(page)).toContainText(text);
  // The composer empties once the send has gone; until then Send takes no other, so the next send waits for it.
  await expect(page.locator("#message")).toHaveValue("", { timeout: 60_000 });
}

/**
 * Two members with keys saved, a conversation Alice started with a first message before Bob accepted (Alex,
 * 2026-11-21: the asker writes along with the request), which Bob reads once he has, and one message each way after.
 */
async function talking(browser: Browser) {
  const alice = await stack.member(`alice${Date.now()}.unset.name`);
  const bob = await stack.member(`bob${Date.now()}.unset.name`, "Bob \u202ERamos");
  const a = await browserFor(browser, alice.handle);
  const b = await browserFor(browser, bob.handle);
  await a.page.goto(`https://unset.cc/?with=${encodeURIComponent(bob.userId)}`);
  const aliceKey = await saveKey(a.page);
  await b.page.goto("https://unset.cc/");
  await saveKey(b.page);
  // The link opened a composer and made nothing; Alice's first Send makes the room and the request.
  await expect(a.page.locator("[data-screen=new-conversation]")).toBeVisible({ timeout: 60_000 });
  await a.page.locator("#message").fill("hello before you accept");
  await a.page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(a.page)).toHaveAttribute("data-composer", "pending", { timeout: 60_000 });
  await expect(messages(a.page)).toContainText("hello before you accept");
  const request = b.page.locator(`[data-request="${alice.userId}"]`);
  await expect(request).toContainText(alice.handle, { timeout: 60_000 });
  await expect(request.locator("[data-mark]")).toHaveAttribute("data-mark", "encrypted");
  await request.getByRole("button", { name: "Accept" }).click();
  // Sent while Bob was only invited, and readable by him once he joined: the key went to his device as an invitee.
  // Bob has a public page, so Alice sees his name over his handle, cleaned of the bidi control (ADR 0107); Alice has
  // none, so Bob sees her handle alone, in the list and in the header.
  const bobName = conversation(a.page).locator("h2 [data-person]");
  await expect(bobName.locator("[data-name]")).toHaveText("Bob Ramos", { timeout: 30_000 });
  await expect(bobName.locator("[data-handle]")).toHaveText(bob.handle);
  const aliceItem = b.page.locator(`[data-conversation="${alice.userId}"] [data-person]`);
  await expect(aliceItem).toHaveAttribute("data-person", "handle", { timeout: 30_000 });
  await expect(aliceItem).toHaveText(alice.handle);
  await b.page.locator(`[data-conversation="${alice.userId}"]`).click();
  await expect(messages(b.page)).toContainText("hello before you accept", { timeout: 60_000 });
  await expect(conversation(b.page).locator("h2")).toHaveText(alice.handle);
  // Alice's device is signed by her own keys, so no message carries the unconfirmed-device warning (ADR 0104). Bob's
  // browser may read the message before it knows her device; the mark goes once his device list has it.
  await expect(unconfirmed(b.page)).toHaveCount(0, { timeout: 30_000 });
  await send(a.page, "hello from alice");
  await expect(messages(b.page)).toContainText("hello from alice", { timeout: 60_000 });
  // Bob's page marks it read with a public receipt, so Alice sees "Seen" and the time under it (ADR 0103 decision 4).
  const read = message(a.page, "hello from alice").locator("[data-seen]");
  await expect(read).toHaveText(/^Seen \d/, { timeout: 60_000 });
  // Bob reacts from the message's actions, from the keyboard alone: Tab from the message's text reaches React, which
  // shows the actions (Chromium starts sequential focus at the point clicked). Alice sees the reaction, and it goes
  // when Bob takes it back (ADR 0103 decision 1).
  const bobs = message(b.page, "hello from alice");
  await bobs.getByText("hello from alice", { exact: true }).click();
  await b.page.mouse.move(0, 0); // not shown by hover: only focus shows them now
  await expect(bobs.locator("[data-actions]")).toHaveCSS("opacity", "0");
  await b.page.keyboard.press("Tab");
  const react = bobs.getByRole("button", { name: "React", exact: true });
  await expect(react).toBeFocused();
  await expect(bobs.locator("[data-actions]")).toHaveCSS("opacity", "1");
  await b.page.keyboard.press("Enter");
  await bobs.getByRole("button", { name: "React with 👍" }).click();
  const thumbs = message(a.page, "hello from alice").locator('[data-reaction="👍"]');
  await expect(thumbs).toHaveText("👍 1", { timeout: 60_000 });
  await expect(bobs.locator('[data-reaction="👍"]')).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await bobs.locator('[data-reaction="👍"]').click();
  await expect(thumbs).toHaveCount(0, { timeout: 60_000 });
  // Bob replies to it; Alice sees the reply with her message quoted above it (ADR 0103 decision 3).
  await bobs.hover();
  await bobs.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(b.page.locator("[data-replying]")).toContainText("hello from alice");
  await send(b.page, "a reply from bob");
  const answer = message(a.page, "a reply from bob");
  await expect(answer.locator("[data-reply-to]")).toContainText("You hello from alice", { timeout: 60_000 });
  await send(b.page, "hello from bob");
  await expect(messages(a.page)).toContainText("hello from bob", { timeout: 60_000 });
  // Text typed while a send is still going stays in the composer; only what was sent is cleared.
  await a.page.locator("#message").fill("sent first");
  await a.page.getByRole("button", { name: "Send" }).click();
  await a.page.locator("#message").fill("typed meanwhile");
  await expect(messages(b.page)).toContainText("sent first", { timeout: 60_000 });
  await expect(a.page.getByRole("button", { name: "Send" })).toBeEnabled();
  await expect(a.page.locator("#message")).toHaveValue("typed meanwhile");
  await a.page.locator("#message").fill("");
  await deleting(a, b);
  for (const p of [a, b]) await expect(unconfirmed(p.page)).toHaveCount(0, { timeout: 30_000 });
  return { alice, bob, a, b, aliceKey };
}

type Member = { readonly page: Page };

/**
 * Alice deletes her own messages (ADR 0103 decision 2; Alex, 2026-11-21 20:42Z): one after confirming, two selected
 * together after confirming with "Don't ask me again", and then one at once, with no confirm. Bob sees "Message
 * deleted" in each one's place, with the time it was sent; Bob's messages get no Delete and no checkbox on her page.
 */
async function deleting(a: Member, b: Member) {
  for (const text of ["oops from alice", "one to go", "two to go", "three to go"]) await send(a.page, text);
  await expect(messages(b.page)).toContainText("three to go", { timeout: 60_000 });
  const idOf = async (text: string) => (await message(a.page, text).getAttribute("data-message")) ?? "";
  const ids = await Promise.all(["oops from alice", "one to go", "two to go", "three to go"].map(idOf));
  const order = (page: Page) => page.locator("li[data-message]").evaluateAll((li) => li.map((e) => e.dataset.message));
  const ordersBefore = [await order(a.page), await order(b.page)];
  const sentAt = await Promise.all(
    ids.map((id) => a.page.locator(`[data-message="${id}"] time`).getAttribute("datetime")),
  );
  // Only the sender has Delete; the toolbar is in the page but hidden until hover, hence includeHidden.
  const deleteOn = (page: Page) =>
    message(page, "oops from alice").getByRole("button", { name: "Delete", exact: true, includeHidden: true });
  await expect(deleteOn(a.page)).toHaveCount(1);
  await expect(deleteOn(b.page)).toHaveCount(0);
  const confirm = a.page.locator("[data-confirm-delete]");
  // A window tall enough that the page does not scroll, so nothing above the confirm may move it while it is open: the
  // confirm's buttons are pressed with the mouse, where a press takes focus out of the message (a scrolled page hid
  // that, as the browser held the bottom in place).
  const size = a.page.viewportSize();
  await a.page.setViewportSize({ width: 1280, height: 2400 });
  // One, after the confirm.
  const oops = message(a.page, "oops from alice");
  await oops.hover();
  await oops.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toContainText("Delete this message? It is deleted for both of you.");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  // Two, selected from the same menu: only her own messages get a checkbox.
  const one = message(a.page, "one to go");
  await one.hover();
  await one.getByRole("button", { name: "Select", exact: true }).click();
  await expect(one.getByRole("checkbox", { name: "Select message" })).toBeChecked();
  await expect(message(a.page, "hello from bob").getByRole("checkbox")).toHaveCount(0);
  await message(a.page, "two to go").getByRole("checkbox", { name: "Select message" }).click();
  await a.page.locator("[data-selecting]").getByRole("button", { name: "Delete 2" }).click();
  await expect(confirm).toContainText("Delete 2 messages? They are deleted for both of you.");
  await confirm.getByRole("checkbox", { name: "Don't ask me again" }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(a.page.locator("[data-selecting]")).toHaveCount(0);
  // And then one at once: "Don't ask me again" holds in this browser.
  const three = message(a.page, "three to go");
  await three.hover();
  await three.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  if (size !== null) await a.page.setViewportSize(size);
  for (const p of [a, b])
    for (const id of ids)
      await expect(p.page.locator(`[data-message="${id}"] [data-deleted]`)).toHaveText("Message deleted", {
        timeout: 60_000,
      });
  for (const text of ["oops from alice", "one to go", "two to go", "three to go"])
    await expect(messages(b.page)).not.toContainText(text);
  // Each in its place, with the time it was sent.
  expect([await order(a.page), await order(b.page)]).toEqual(ordersBefore);
  for (const p of [a, b])
    for (const [i, id] of ids.entries())
      await expect(p.page.locator(`[data-message="${id}"] time`)).toHaveAttribute("datetime", sentAt[i] ?? "");
}

/**
 * A fresh sync brings only the newest events; earlier messages come with "Show older messages", pressed until `text`
 * shows.
 */
async function scrolledBackTo(page: Page, text: string) {
  const older = page.getByRole("button", { name: "Show older messages" });
  await expect(async () => {
    if (await older.isVisible()) await older.click();
    await expect(messages(page)).toContainText(text, { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
}

/** A Synapse admin read, for the checks only. */
async function admin(path: string): Promise<Record<string, unknown>> {
  const token = await stack.synapseAdmin();
  const url = new URL(path, (servers as RealServers).synapse);
  const answer = await fetch(url, { headers: { authorization: `Bearer ${token}` } }); // guard-allow: egress test, local Synapse only
  return (await answer.json()) as Record<string, unknown>;
}
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

test("chat_e2e.talk_unlock_log_out: two members talk encrypted; a new browser reads history; Log out wipes", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { alice, a, b, aliceKey } = await talking(browser);
  // The server holds ciphertext only: every message event in the room is m.room.encrypted.
  const rooms = (await admin(`/_synapse/admin/v1/users/${encodeURIComponent(alice.userId)}/joined_rooms`))
    .joined_rooms as string[];
  expect(rooms).toHaveLength(1);
  const chunk = (await admin(`/_synapse/admin/v1/rooms/${encodeURIComponent(rooms[0] ?? "")}/messages?dir=b&limit=50`))
    .chunk as { type: string; content: unknown }[];
  const sent = chunk.filter((e) => e.type === "m.room.encrypted" || e.type === "m.room.message");
  expect(sent.map((e) => e.type)).toEqual(Array(9).fill("m.room.encrypted"));
  // The four deleted keep no ciphertext on the server (spec v1.18 #redactions).
  expect(sent.filter((e) => Object.keys(e.content as object).length === 0)).toHaveLength(4);
  // The reply's pointer is the one thing beside its ciphertext (ADR 0103 decision 3).
  const relations = sent.map((e) => (e.content as Record<string, unknown>)["m.relates_to"]).filter(Boolean);
  expect(relations).toEqual([{ "m.in_reply_to": { event_id: expect.stringMatching(/^\$/) } }]);
  // Beside them only Bob's reaction, which is in the clear by design and was taken back (ADR 0103 decisions 1, 2).
  expect(chunk.filter((e) => !e.type.startsWith("m.room.")).map((e) => e.type)).toEqual(["m.reaction"]);
  expect(JSON.stringify(chunk)).not.toContain("hello");
  // A second browser of Alice's is locked, unlocks with the saved key, and reads the history from the key backup,
  // opened at once: the first browser may not have uploaded the room's keys yet (it waits up to 10 s, matrix-js-sdk
  // 43.0.0 src/rust-crypto/backup.ts:70), and the page asks the backup again once it has (matrix/recovery.ts).
  const a2 = await browserFor(browser, alice.handle);
  await a2.page.goto("https://unset.cc/");
  await expect.poll(() => state(a2.page), { timeout: 60_000 }).toBe("locked");
  await a2.page.locator("#unlock-key").fill(aliceKey);
  await a2.page.getByRole("button", { name: "Unlock" }).click();
  await expect.poll(() => state(a2.page), { timeout: 60_000 }).toBe("ready");
  await a2.page.locator("[data-conversation]").first().click();
  await scrolledBackTo(a2.page, "hello from alice");
  await expect(messages(a2.page)).toContainText("hello from bob", { timeout: 90_000 });
  await expect(messages(a2.page)).toContainText("hello from alice", { timeout: 90_000 });
  // Keys from the backup give a grey shield, which Element shows as a plain padlock: no warning either.
  await expect(unconfirmed(a2.page)).toHaveCount(0, { timeout: 30_000 });
  // Log out of unset.sh on the first browser, from another of its tabs (Alex 2026-11-21: there is no Log out on the chat
  // page): the open chat tab stops, the device ends at the homeserver, nothing of the account is left in that browser,
  // and the other browser is untouched.
  const device = a.redeems[0]?.deviceId ?? "";
  // "Don't ask me again" lives only in this browser's localStorage, under the account's key (conversation-service.ts).
  const choices = () =>
    a.page.evaluate(() => Object.keys(globalThis.localStorage).filter((key) => key.startsWith("unset-chat:")));
  expect(await choices()).toEqual([`unset-chat:${alice.userId}:skip-delete-confirm`]);
  const out = await a.context.newPage();
  await out.goto("https://unset.sh/logout");
  await out.waitForURL("https://unset.sh/signed-out", { timeout: 90_000 });
  expect(await state(a.page)).toBe("open_elsewhere");
  const names = await a.page.evaluate(async () => {
    const { indexedDB } = globalThis as unknown as { indexedDB: { databases(): Promise<{ name?: string }[]> } };
    return (await indexedDB.databases()).map((d) => d.name ?? "");
  });
  expect(names.filter((n) => n.startsWith("unset-chat:"))).toEqual([]);
  expect(await choices()).toEqual([]);
  const devices = (await admin(`/_synapse/admin/v2/users/${encodeURIComponent(alice.userId)}/devices`)).devices as {
    device_id: string;
  }[];
  expect(devices.map((d) => d.device_id)).not.toContain(device);
  expect(await state(a2.page)).toBe("ready");
  await send(b.page, "still here");
  await expect(messages(a2.page)).toContainText("still here", { timeout: 60_000 });
  for (const p of [a, b, a2]) expect(p.problems).toEqual([]);
});

test("chat_e2e.first_message_no_browser: a request sent while the other has no browser open is read once they do", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  // Staging, 2026-11-23: the first messages went with the request while the other member had no browser signed in to
  // chat, so no device of theirs got the keys and their new browser could not read them. Element's offline device
  // (MSC3814; ADR 0113) holds them: the new browser picks it up when it unlocks with the recovery key.
  const alice = await stack.member(`alice${Date.now()}.unset.name`);
  const bob = await stack.member(`bob${Date.now()}.unset.name`);
  const b1 = await browserFor(browser, bob.handle);
  await b1.page.goto("https://unset.cc/");
  const bobKey = await saveKey(b1.page);
  // Bob leaves unset.sh, which ends that browser's device: he now has no browser in chat at all.
  const out = await b1.context.newPage();
  await out.goto("https://unset.sh/logout");
  await out.waitForURL("https://unset.sh/signed-out", { timeout: 90_000 });
  // So the only device Bob has is the offline one: only it can be given the keys of what Alice sends now. Synapse's
  // admin list shows it like any device (it is registered as one, synapse/handlers/device.py:480-484).
  const bobDevices = async () =>
    ((await admin(`/_synapse/admin/v2/users/${encodeURIComponent(bob.userId)}/devices`)).devices as unknown[]).length;
  await expect.poll(bobDevices, { timeout: 60_000 }).toBe(1);
  const a = await browserFor(browser, alice.handle);
  await a.page.goto(`https://unset.cc/?with=${encodeURIComponent(bob.userId)}`);
  await saveKey(a.page);
  await expect(a.page.locator("[data-screen=new-conversation]")).toBeVisible({ timeout: 60_000 });
  await a.page.locator("#message").fill("sent while you were away");
  await a.page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(a.page)).toHaveAttribute("data-composer", "pending", { timeout: 60_000 });
  // Alice keeps writing while the request waits (Alex, 2026-11-22).
  await send(a.page, "and a second one", "pending");
  // A fresh browser of Bob's unlocks, accepts and reads both.
  const b2 = await browserFor(browser, bob.handle);
  await b2.page.goto("https://unset.cc/");
  await expect.poll(() => state(b2.page), { timeout: 60_000 }).toBe("locked");
  await b2.page.locator("#unlock-key").fill(bobKey);
  await b2.page.getByRole("button", { name: "Unlock" }).click();
  await expect.poll(() => state(b2.page), { timeout: 60_000 }).toBe("ready");
  const request = b2.page.locator(`[data-request="${alice.userId}"]`);
  await request.getByRole("button", { name: "Accept" }).click({ timeout: 60_000 });
  await b2.page.locator(`[data-conversation="${alice.userId}"]`).click();
  await expect(messages(b2.page)).toContainText("sent while you were away", { timeout: 90_000 });
  await expect(messages(b2.page)).toContainText("and a second one", { timeout: 90_000 });
  await expect(messages(b2.page).locator("[data-unreadable]")).toHaveCount(0);
  for (const p of [a, b2]) expect(p.problems).toEqual([]);
});

test("chat_e2e.signup_step: from signup a new member saves the key, has a pusher at Synapse, and goes back", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const carol = await stack.member(`carol${Date.now()}.unset.name`);
  const c = await browserFor(browser, carol.handle);
  await c.page.goto("https://unset.cc/welcome");
  await saveKey(c.page);
  await expect(c.page.getByRole("heading", { name: "Your messages are set up" })).toBeVisible();
  // The count's pusher is registered before the way back shows (ADR 0094 decision 1). Synapse 1.162.0 admin API
  // GET /_synapse/admin/v1/users/<user_id>/pushers (synapse/rest/admin/users.py PushersRestServlet).
  const listed = await admin(`/_synapse/admin/v1/users/${encodeURIComponent(carol.userId)}/pushers`);
  expect(listed.total).toBe(1);
  expect((listed.pushers as { app_id: string; kind: string }[])[0]).toMatchObject({
    kind: "http",
    app_id: "sh.unset.count",
  });
  await c.page.getByRole("link", { name: "Continue" }).click();
  await c.page.waitForURL("https://unset.sh/welcome/chat");
  expect(c.problems).toEqual([]);
});

test("chat_e2e.suspend_and_back: a lock stops Alice's open page; an unlock brings the same browser back", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { alice, a, b } = await talking(browser);
  const lockedAt = Date.now();
  expect(await stack.chatAdmin.setLocked(alice.user, true)).toEqual({ kind: "done" });
  // Build plan unverified: how fast a lock takes effect on an open page. The page stops once the homeserver refuses
  // the token, and the sign-in it then tries is refused for a locked account.
  await expect.poll(() => state(a.page), { timeout: 180_000, intervals: [500] }).not.toBe("ready");
  note("lock_stops_open_page_ms", String(Date.now() - lockedAt));
  await expect.poll(() => state(a.page), { timeout: 60_000 }).toBe("error");
  // Bob can still see the conversation while Alice is suspended (ADR 0096 Consequences).
  await expect(messages(b.page)).toContainText("hello from alice");
  expect(await stack.chatAdmin.setLocked(alice.user, false)).toEqual({ kind: "done" });
  await a.page.getByRole("link", { name: "Try again" }).click();
  // The same browser, the same device and lock key: no unlock is asked (ADR 0096 decision 2).
  await expect.poll(() => state(a.page), { timeout: 60_000 }).toBe("ready");
  const [first, last] = [a.redeems[0], a.redeems.at(-1)];
  expect([last?.deviceId, last?.storageKey, last?.newDevice]).toEqual([first?.deviceId, first?.storageKey, false]);
  await a.page.locator("[data-conversation]").first().click();
  await scrolledBackTo(a.page, "hello from bob");
});

test("chat_e2e.delete: deactivating ends Alice's chat; Bob keeps the conversation; what the server keeps", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { alice, a, b } = await talking(browser);
  expect(await stack.chatAdmin.deactivateAccount(alice.user)).toEqual({ kind: "done" });
  await expect.poll(() => state(a.page), { timeout: 180_000, intervals: [500] }).not.toBe("ready");
  // Bob keeps his copy, Alice's messages included, and sees that she left.
  await expect(messages(b.page)).toContainText("hello from alice");
  await expect(conversation(b.page)).not.toHaveAttribute("data-composer", "on", { timeout: 60_000 });
  // Erasure deletes her profile, so Bob sees a neutral name, never her chat ID (core/conversations.ts nameOf).
  await expect(conversation(b.page).locator("h2").first()).toHaveText("Former member", { timeout: 60_000 });
  // What the homeserver keeps of the erased account (build plan unverified, ADR 0096 Consequences).
  const user = await admin(`/_synapse/admin/v2/users/${encodeURIComponent(alice.userId)}`);
  expect(user).toMatchObject({ deactivated: true, erased: true });
  note("erased_displayname", JSON.stringify(user.displayname ?? null));
  const data = (await admin(`/_synapse/admin/v1/users/${encodeURIComponent(alice.userId)}/accountdata`))
    .account_data as { global: Record<string, unknown> };
  note("erased_account_data_types", JSON.stringify(Object.keys(data.global).sort()));
  const joined = (await admin(`/_synapse/admin/v1/users/${encodeURIComponent(alice.userId)}/joined_rooms`))
    .joined_rooms as string[];
  expect(joined).toEqual([]);
  // None left, the offline device included (ADR 0113; first_message_no_browser shows the admin list holds it).
  const devices = (await admin(`/_synapse/admin/v2/users/${encodeURIComponent(alice.userId)}/devices`)).devices as [];
  expect(devices).toEqual([]);
});
