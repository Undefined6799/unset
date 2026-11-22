// The chat partner's public name (migration 0053; ADR 0107): door.chat_name, read by `chat_auth` as the real role
// (TE-2). Rows are written as the roles that own them in production: web's account and chat mapping, the indexer's
// account and profile. A member whose public page shows gives their profile's display name by chat user; a hidden
// one (inactive, delisted, no profile, chat not ready) reads as missing, as on their page (D7, SE-2); and chat_auth
// can read neither idx.profile nor app.chat_account itself.
import { randomBytes } from "node:crypto";
import { relative } from "node:path";
import { createPool, type Pool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const as = (role: "chat_auth" | "web" | "indexer"): Pool =>
  createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles[role], database, ssl: false },
    service: `chat-name-test-${role}`,
    max: 2,
    connectTimeoutMs: 5000,
  });
const [door, web, indexer] = [as("chat_auth"), as("web"), as("indexer")];
afterAll(() => Promise.all([door.end(), web.end(), indexer.end()]));

const base32 = (length: number) =>
  Array.from(randomBytes(length), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("");

type Member = { chat?: "pending" | "ready"; active?: boolean; profile?: boolean };
/** A member named `name` as web and the indexer would leave them; returns their chat user. */
async function member(name: string, { chat = "ready", active = true, profile = true }: Member = {}) {
  const did = `did:plc:${base32(24)}`;
  const user = `u${base32(20)}`;
  await withClient(web, null, async (c) => {
    await c.query("INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ($1, now(), 'done')", [did]);
    await c.query("INSERT INTO app.chat_account (did, chat_user) VALUES ($1, $2)", [did, user]);
    await c.query("UPDATE app.chat_account SET state = $2 WHERE did = $1", [did, chat]);
  });
  await withClient(indexer, null, async (c) => {
    await c.query("INSERT INTO idx.account (did, updated_at) VALUES ($1, now())", [did]);
    await c.query("UPDATE idx.account SET pds_active = $2 WHERE did = $1", [did, active]);
    if (!profile) return;
    await c.query(
      `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
       VALUES ($1, $2, 'cid', '3l', '{}', $3, false, now())`,
      [did, `at://${did}/sh.unset.profile/self`, name],
    );
  });
  return user;
}

const nameOf = async (user: string) => {
  const { rows } = await withClient(door, null, (c) =>
    c.query<{ display_name: string | null }>("SELECT display_name FROM door.chat_name WHERE chat_user = $1", [user]),
  );
  return rows.length === 0 ? undefined : rows[0]?.display_name;
};

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

describe("chat name view", () => {
  test("door.name_shown: a member whose public page shows gives their display name by chat user", async () => {
    expect(await nameOf(await member("Ada Lovelace"))).toBe("Ada Lovelace");
  });

  test("door.name_hidden: inactive, no profile, chat not ready, unknown: all read as missing", async () => {
    const hidden = await Promise.all([
      member("Inactive", { active: false }),
      member("Unpublished", { profile: false }),
      member("Pending", { chat: "pending" }),
    ]);
    for (const user of hidden) expect(await nameOf(user)).toBeUndefined();
    expect(await nameOf(`u${base32(20)}`)).toBeUndefined();
  });

  test("door.name_least_privilege: chat_auth reads the view and nothing under it", async () => {
    expect(await codeOf("SELECT display_name FROM idx.profile LIMIT 1")).toBe("42501");
    expect(await codeOf("SELECT did FROM idx.public_profile LIMIT 1")).toBe("42501");
    expect(await codeOf("SELECT chat_user, display_name FROM door.chat_name LIMIT 1")).toBe("allowed");
  });
});
