// The whole minimal chat in real browsers (build step 11), against real Synapse and MAS (fixtures/chat-servers.ts): two
// members set up their keys, start a conversation, accept it and exchange end-to-end encrypted messages; a second
// browser unlocks with the recovery key and reads the history; Log out leaves nothing behind; suspension locks an open
// page and lifting it brings the same browser back with no unlock (ADR 0084 decisions 1 and 2); deletion ends the
// account and the other member keeps the conversation (decision 3). It also records the build plan's step-11
// unverified items as annotations: how fast a lock stops an open page and what the homeserver keeps of an erased
// account. The count (build step 10, ADR 0090) runs through the door's real count port and Postgres store: a chat
// request and a message reach the member's number, a read clears it, and an old pushkey is rejected. The server rule
// (P6.10a, ADR 0085) is checked against what the SDK sends for a reaction and a redaction.
// Chromium only, by its name (playwright.config.ts). Skipped, saying why, when the run is not pointed at the servers.
import { DatabaseSync } from "node:sqlite";
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
  return { page, redeems, problems };
}

const state = (page: Page) => page.locator("main").getAttribute("data-state");
const conversation = (page: Page) => page.locator("[data-screen=conversation]");
const messages = (page: Page) => conversation(page).locator("ol");

async function saveKey(page: Page): Promise<string> {
  await expect.poll(() => state(page), { timeout: 60_000 }).not.toBe("signing_in");
  if ((await state(page)) === "error") throw new Error(`chat page error: ${await page.locator("main").textContent()}`);
  await expect.poll(() => state(page), { timeout: 60_000 }).toBe("save_key");
  const key = await page.locator("#recovery-key").inputValue();
  await page.locator("#key-end").fill(key.replaceAll(" ", "").slice(-4));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => state(page), { timeout: 60_000 }).toBe("ready");
  return key;
}

async function send(page: Page, text: string): Promise<void> {
  await expect(conversation(page)).toHaveAttribute("data-composer", "on", { timeout: 60_000 });
  await page.locator("#message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(messages(page)).toContainText(text);
}

/** Two members with keys saved, a conversation Alice started and Bob accepted, and one message each way. */
async function talking(browser: Browser) {
  const alice = await stack.member(`alice${Date.now()}.unset.name`);
  const bob = await stack.member(`bob${Date.now()}.unset.name`);
  const a = await browserFor(browser, alice.handle);
  const b = await browserFor(browser, bob.handle);
  await a.page.goto(`https://unset.cc/?with=${encodeURIComponent(bob.userId)}`);
  const aliceKey = await saveKey(a.page);
  await b.page.goto("https://unset.cc/");
  await saveKey(b.page);
  await expect(conversation(a.page)).toHaveAttribute("data-composer", "waiting_for_them", { timeout: 60_000 });
  const request = b.page.locator(`[data-request="${alice.userId}"]`);
  await expect(request).toContainText(alice.handle, { timeout: 60_000 });
  await expect(request.locator("[data-mark]")).toHaveAttribute("data-mark", "encrypted");
  await request.getByRole("button", { name: "Accept" }).click();
  await send(a.page, "hello from alice");
  await b.page.locator(`[data-conversation="${alice.userId}"]`).click();
  await expect(messages(b.page)).toContainText("hello from alice", { timeout: 60_000 });
  await send(b.page, "hello from bob");
  await expect(messages(a.page)).toContainText("hello from bob", { timeout: 60_000 });
  return { alice, bob, a, b, aliceKey };
}

/** A Synapse admin read, for the checks only. */
async function admin(path: string): Promise<Record<string, unknown>> {
  const token = await stack.synapseAdmin();
  const url = new URL(path, (servers as RealServers).synapse);
  const answer = await fetch(url, { headers: { authorization: `Bearer ${token}` } }); // guard-allow: egress test, local Synapse only
  return (await answer.json()) as Record<string, unknown>;
}
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

/**
 * Rows the homeserver keeps for `userId` in its key tables, read from its SQLite database when CHAT_E2E_SYNAPSE_SQLITE
 * names it (the dev homeserver.yaml's database; read-only), else null.
 */
function synapseRows(userId: string): Record<string, number> | null {
  const path = process.env.CHAT_E2E_SYNAPSE_SQLITE ?? "";
  if (path === "") return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = ["e2e_room_keys", "e2e_room_keys_versions", "account_data", "e2e_cross_signing_keys"] as const;
    const count = (table: string) =>
      Number((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n);
    return Object.fromEntries(tables.map((table) => [table, count(table)]));
  } finally {
    db.close();
  }
}

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
  const timeline = chunk.filter(
    (e) => !e.type.startsWith("m.room.") || e.type === "m.room.encrypted" || e.type === "m.room.message",
  );
  expect(timeline.map((e) => e.type)).toEqual(["m.room.encrypted", "m.room.encrypted"]);
  expect(JSON.stringify(chunk)).not.toContain("hello from");
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
  await expect(messages(a2.page)).toContainText("hello from bob", { timeout: 90_000 });
  await expect(messages(a2.page)).toContainText("hello from alice", { timeout: 90_000 });
  // Log out on the first browser: its device ends at the homeserver, nothing of the account is left in that browser,
  // and the other browser is untouched.
  const device = a.redeems[0]?.deviceId ?? "";
  await a.page.getByRole("button", { name: "Log out" }).click();
  await expect.poll(() => state(a.page), { timeout: 60_000 }).toBe("logged_out");
  const names = await a.page.evaluate(async () => {
    const { indexedDB } = globalThis as unknown as { indexedDB: { databases(): Promise<{ name?: string }[]> } };
    return (await indexedDB.databases()).map((d) => d.name ?? "");
  });
  expect(names.filter((n) => n.startsWith("unset-chat:"))).toEqual([]);
  const devices = (await admin(`/_synapse/admin/v2/users/${encodeURIComponent(alice.userId)}/devices`)).devices as {
    device_id: string;
  }[];
  expect(devices.map((d) => d.device_id)).not.toContain(device);
  expect(await state(a2.page)).toBe("ready");
  await send(b.page, "still here");
  await expect(messages(a2.page)).toContainText("still here", { timeout: 60_000 });
  for (const p of [a, b, a2]) expect(p.problems).toEqual([]);
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
  // Bob can still see the conversation while Alice is suspended (ADR 0084 Consequences).
  await expect(messages(b.page)).toContainText("hello from alice");
  expect(await stack.chatAdmin.setLocked(alice.user, false)).toEqual({ kind: "done" });
  await a.page.getByRole("link", { name: "Try again" }).click();
  // The same browser, the same device and lock key: no unlock is asked (ADR 0084 decision 2).
  await expect.poll(() => state(a.page), { timeout: 60_000 }).toBe("ready");
  const [first, last] = [a.redeems[0], a.redeems.at(-1)];
  expect([last?.deviceId, last?.storageKey, last?.newDevice]).toEqual([first?.deviceId, first?.storageKey, false]);
  await a.page.locator("[data-conversation]").first().click();
  await expect(messages(a.page)).toContainText("hello from bob", { timeout: 60_000 });
});

test("chat_e2e.delete: deactivating ends Alice's chat; Bob keeps the conversation; what the server keeps", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { alice, a, b } = await talking(browser);
  // Alice has a key backup on the server before she goes (spec v1.18 GET /room_keys/version).
  const version = new URL("/_matrix/client/v3/room_keys/version", (servers as RealServers).synapse);
  const bearer = { authorization: `Bearer ${a.redeems.at(-1)?.accessToken ?? ""}` };
  const backup = await fetch(version, { headers: bearer }); // guard-allow: egress test, local Synapse only
  expect(backup.status).toBe(200);
  expect(await stack.chatAdmin.deactivateAccount(alice.user)).toEqual({ kind: "done" });
  await expect.poll(() => state(a.page), { timeout: 180_000, intervals: [500] }).not.toBe("ready");
  // Bob keeps his copy, Alice's messages included, and sees that she left.
  await expect(messages(b.page)).toContainText("hello from alice");
  await expect(conversation(b.page)).not.toHaveAttribute("data-composer", "on", { timeout: 60_000 });
  // Erasure deletes her profile, so Bob sees a neutral name, never her chat ID (core/conversations.ts nameOf).
  await expect(conversation(b.page).locator("h2").first()).toHaveText("Former member", { timeout: 60_000 });
  // What the homeserver keeps of the erased account (build plan unverified, ADR 0084 Consequences).
  const user = await admin(`/_synapse/admin/v2/users/${encodeURIComponent(alice.userId)}`);
  expect(user).toMatchObject({ deactivated: true, erased: true });
  note("erased_displayname", JSON.stringify(user.displayname ?? null));
  const data = (await admin(`/_synapse/admin/v1/users/${encodeURIComponent(alice.userId)}/accountdata`))
    .account_data as { global: Record<string, unknown> };
  note("erased_account_data_types", JSON.stringify(Object.keys(data.global).sort()));
  const joined = (await admin(`/_synapse/admin/v1/users/${encodeURIComponent(alice.userId)}/joined_rooms`))
    .joined_rooms as string[];
  expect(joined).toEqual([]);
  const devices = (await admin(`/_synapse/admin/v2/users/${encodeURIComponent(alice.userId)}/devices`)).devices as [];
  expect(devices).toEqual([]);
  // Her key backup and secret storage are gone from the homeserver's database: Synapse 1.165.0's deactivation removes
  // account data (secret storage is account data, spec v1.18 #secret-storage) and every backup version and session
  // (handlers/deactivate_account.py:209 and :215, bulk_delete_backup_keys_and_versions_for_user). No admin API reads
  // them, so this reads the database when the run names it; her cross-signing public keys stay (note).
  const kept = synapseRows(alice.userId);
  if (kept !== null) {
    expect(kept).toMatchObject({ e2e_room_keys: 0, e2e_room_keys_versions: 0, account_data: 0 });
    note("erased_rows_kept", JSON.stringify(kept));
  }
});

type Pusher = { pushkey: string; app_id: string };
const pushersOf = async (member: { userId: string }) =>
  ((await admin(`/_synapse/admin/v1/users/${encodeURIComponent(member.userId)}/pushers`)).pushers as Pusher[]) ?? [];
/** What Synapse sent to `pushkey`, without the key or event ids: the shape and the number. */
const sentTo = (pushkey: string) =>
  stack.notifications
    .map((n) => n.body as { notification?: { counts?: unknown; devices?: { pushkey?: string }[] } & Json })
    .filter((b) => b.notification?.devices?.some((d) => d.pushkey === pushkey))
    .map((b) => ({ keys: Object.keys(b.notification ?? {}).sort(), counts: b.notification?.counts ?? null }));
type Json = Record<string, unknown>;

test("chat_e2e.count: a request and a message reach Alice's stored count; her read clears it; an old key is refused", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const alice = await stack.member(`alice${Date.now()}.unset.name`);
  const bob = await stack.member(`bob${Date.now()}.unset.name`);
  const a = await browserFor(browser, alice.handle);
  await a.page.goto("https://unset.cc/");
  await saveKey(a.page);
  await expect.poll(async () => (await pushersOf(alice)).length, { timeout: 30_000 }).toBe(1);
  const [first] = await pushersOf(alice);
  const oldKey = first?.pushkey ?? "";
  expect(await stack.count(alice.did)).toBeNull();
  // A chat request: Bob starts a conversation with Alice. Synapse counts each pending invite as one (push_tools.py
  // get_badge_count, v1.165.0 lines 30-33) and pushes it (.m.rule.invite_for_me); ADR 0082 decision 4 expects it.
  const b = await browserFor(browser, bob.handle);
  await b.page.goto(`https://unset.cc/?with=${encodeURIComponent(alice.userId)}`);
  await saveKey(b.page);
  await expect.poll(() => stack.count(alice.did), { timeout: 60_000 }).toBe(1);
  note("request_push", JSON.stringify(sentTo(oldKey)));
  const request = a.page.locator(`[data-request="${bob.userId}"]`);
  await request.getByRole("button", { name: "Accept" }).click();
  await expect(conversation(b.page)).toHaveAttribute("data-composer", "on", { timeout: 60_000 });
  note("count_after_accept", JSON.stringify(await stack.count(alice.did)));
  // Alice's page is closed, so nothing reads for her: Bob's message is pushed with the number 1.
  await a.page.close();
  const before = sentTo(oldKey).length;
  await send(b.page, "one");
  await expect.poll(() => sentTo(oldKey).length, { timeout: 60_000 }).toBeGreaterThan(before);
  expect(sentTo(oldKey).at(-1)?.counts).toEqual({ unread: 1 });
  expect(await stack.count(alice.did)).toBe(1);
  note("message_push", JSON.stringify(sentTo(oldKey).slice(before)));
  // Alice comes back in the same browser (a new sign-in, so a new pushkey) and reads: her number is 0.
  const again = await a.page.context().newPage();
  await again.goto("https://unset.cc/");
  await expect.poll(() => state(again), { timeout: 60_000 }).toBe("ready");
  await again.locator(`[data-conversation="${bob.userId}"]`).click();
  await expect(messages(again)).toContainText("one", { timeout: 60_000 });
  await expect.poll(() => stack.count(alice.did), { timeout: 60_000 }).toBe(0);
  // The old key no longer belongs to her browser: the door rejects it and keeps her number as it was.
  const stale = await stack.notify({
    notification: { counts: { unread: 7 }, devices: [{ app_id: first?.app_id, pushkey: oldKey }] },
  });
  expect(stale).toEqual({ status: 200, body: { rejected: [oldKey] } });
  expect(await stack.count(alice.did)).toBe(0);
  // Synapse drops the old pusher the next time an event push to it is rejected (httppusher.py:377-392).
  await send(b.page, "two");
  await expect
    .poll(async () => (await pushersOf(alice)).map((p) => p.pushkey), { timeout: 60_000 })
    .not.toContain(oldKey);
  expect(await pushersOf(alice)).toHaveLength(1);
});

test("chat_e2e.reaction_and_redaction: in an encrypted room the server rule refuses both, as the SDK sends them", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { alice, a } = await talking(browser);
  const token = a.redeems.at(-1)?.accessToken ?? "";
  const [room] = (await admin(`/_synapse/admin/v1/users/${encodeURIComponent(alice.userId)}/joined_rooms`))
    .joined_rooms as string[];
  const chunk = (await admin(`/_synapse/admin/v1/rooms/${encodeURIComponent(room ?? "")}/messages?dir=b&limit=50`))
    .chunk as { type: string; sender: string; event_id: string }[];
  const own = chunk.find((e) => e.type === "m.room.encrypted" && e.sender === alice.userId)?.event_id ?? "";
  const client = async (path: string, body: Json) => {
    const url = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(room ?? "")}${path}`, servers?.synapse);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const init = { method: "PUT", headers, body: JSON.stringify(body) };
    const answer = await fetch(url, init); // guard-allow: egress test, local Synapse only
    return { status: answer.status, errcode: ((await answer.json()) as { errcode?: string }).errcode };
  };
  // matrix-js-sdk 43.0.0 sends a reaction unencrypted, as m.reaction (src/client.ts:3056-3068), and a redaction
  // unencrypted (lines 3070-3074). ADR 0085 decisions 1 and 2: an encrypted room takes only Megolm ciphertext and
  // refuses every redaction.
  const relation = { "m.relates_to": { rel_type: "m.annotation", event_id: own, key: "yes" } };
  expect(await client(`/send/m.reaction/r${Date.now()}`, relation)).toEqual({ status: 403, errcode: "M_FORBIDDEN" });
  const redact = await client(`/redact/${encodeURIComponent(own)}/d${Date.now()}`, { reason: "mine" });
  expect(redact).toEqual({ status: 403, errcode: "M_FORBIDDEN" });
});
