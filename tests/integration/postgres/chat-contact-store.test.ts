// Build step 10 (infrastructure/postgres/chatContactStore.ts, migration 0048; ADR 0094 decision 6, ADR 0101 decision
// 3): the chat ID behind a profile's Message link, read by `chat_auth` through door.chat_contact only (TE-2). The
// rows are written as the roles that own them in production: web's account and chat mapping, the indexer's account
// and profile. A member is found only when their chat account is ready and their public page shows; every other case
// reads as the same missing; and chat_auth can read neither app.chat_account nor the index itself.
import { randomBytes } from "node:crypto";
import { relative } from "node:path";
import type { Did } from "@unset/domains-identity";
import { createChatContactStore, createPool, type Pool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const as = (role: "chat_auth" | "web" | "indexer"): Pool =>
  createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles[role], database, ssl: false },
    service: `chat-contact-test-${role}`,
    max: 2,
    connectTimeoutMs: 5000,
  });
const [door, web, indexer] = [as("chat_auth"), as("web"), as("indexer")];
afterAll(() => Promise.all([door.end(), web.end(), indexer.end()]));

const contacts = createChatContactStore(door);
const deadline = () => AbortSignal.timeout(5000);
const base32 = (length: number) =>
  Array.from(randomBytes(length), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("");

type Member = { chat?: "pending" | "ready" | "failed" | "none"; active?: boolean; profile?: boolean };
/** A member as web and the indexer would leave them; returns their DID and chat user. */
async function member({ chat = "ready", active = true, profile = true }: Member = {}) {
  const did = `did:plc:${base32(24)}` as Did;
  const user = `u${base32(20)}`;
  await withClient(web, null, async (c) => {
    await c.query("INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ($1, now(), 'done')", [did]);
    if (chat === "none") return;
    await c.query("INSERT INTO app.chat_account (did, chat_user) VALUES ($1, $2)", [did, user]);
    await c.query("UPDATE app.chat_account SET state = $2 WHERE did = $1", [did, chat]);
  });
  await withClient(indexer, null, async (c) => {
    await c.query("INSERT INTO idx.account (did, updated_at) VALUES ($1, now())", [did]);
    await c.query("UPDATE idx.account SET pds_active = $2 WHERE did = $1", [did, active]);
    if (!profile) return;
    await c.query(
      `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
       VALUES ($1, $2, 'cid', '3l', '{}', 'N', false, now())`,
      [did, `at://${did}/sh.unset.profile/self`],
    );
  });
  return { did, user };
}

const codeOf = async (sql: string) => {
  try {
    await withClient(door, null, (c) => c.query(sql));
  } catch (error) {
    let at: unknown = error;
    while (at instanceof Error && (at as { code?: unknown }).code === undefined && at.cause !== undefined)
      at = at.cause;
    return String((at as { code?: unknown }).code);
  }
  return "allowed";
};

describe("chat contact store", () => {
  test("door.contact_found: a member with a ready chat account and a public page gives their chat user", async () => {
    const { did, user } = await member();
    expect(await contacts.chatUserOf(did, deadline())).toBe(user);
  });

  test("door.contact_missing: pending, failed, none, an inactive account, no profile, unknown: all the same null", async () => {
    const hidden = await Promise.all([
      member({ chat: "pending" }),
      member({ chat: "failed" }),
      member({ chat: "none" }),
      member({ active: false }),
      member({ profile: false }),
    ]);
    for (const { did } of hidden) expect(await contacts.chatUserOf(did, deadline())).toBeNull();
    expect(await contacts.chatUserOf(`did:plc:${base32(24)}` as Did, deadline())).toBeNull();
  });

  test("door.contact_least_privilege: chat_auth reads the view's two columns and nothing under it", async () => {
    expect(await codeOf("SELECT chat_user FROM app.chat_account LIMIT 1")).toBe("42501");
    expect(await codeOf("SELECT did FROM idx.account LIMIT 1")).toBe("42501");
    expect(await codeOf("SELECT did, chat_user FROM door.chat_contact LIMIT 1")).toBe("allowed");
  });
});
