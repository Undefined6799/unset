// The chat account follows the Unset account's state (infrastructure/postgres/chatLockStore.ts, migration 0043; ADR
// 0084 decisions 1 and 2), against real Postgres connected as `web` (TE-2). The rows are written as their owners
// would leave them (the indexer's account state, a moderator's suspension, web's mapping), here by the superuser.
// A ready chat account whose member is suspended, deactivated or taken down is due for a lock, and for an unlock
// once active again; an account with no recorded state is left alone; web reads the state only through the view.
import { join } from "node:path";
import type { Did } from "@unset/domains-identity";
import { parseChatUser } from "@unset/domains-messaging";
import { createChatAccountStore, createChatLockStore, type Pool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgresAfter,
  testPools,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const pools = testPools("chat-lock-store-test");
const migratorPassword = randomPassword();
const webPassword = randomPassword();
let postgres: PostgresContainer;
let web: Pool;
let locks: ReturnType<typeof createChatLockStore>;
let accounts: ReturnType<typeof createChatAccountStore>;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE web PASSWORD '${webPassword}'`);
  web = pools.open(postgres, "unset", "web", webPassword, { max: 2 });
  locks = createChatLockStore(web, { leaseS: 60 });
  accounts = createChatAccountStore(web, {
    newUser: () => {
      throw new Error("not drawn here");
    },
    leaseS: 60,
  });
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

let n = 0;
type State = { active: boolean; status: string | null; suspended?: boolean; chat?: "ready" | "pending" };
/** A member with a chat account in `chat` state, the PDS state the indexer recorded, and a moderator's suspension. */
function member({ active, status, suspended = false, chat = "ready" }: State) {
  n += 1;
  const letter = "abcdefghijklmnopqrstuvwxyz"[n] ?? "z";
  const did = `did:plc:${letter.repeat(24)}` as Did;
  const user = `u${letter.repeat(20)}`;
  postgres.sql(
    "unset",
    `INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ('${did}', now(), 'done');
     INSERT INTO app.chat_account (did, chat_user, state) VALUES ('${did}', '${user}', '${chat}');
     INSERT INTO idx.account (did, pds_active, pds_status, updated_at)
       VALUES ('${did}', ${active}, ${status === null ? "NULL" : `'${status}'`}, now());
     INSERT INTO mod.account_state (did, mod_suspended, updated_at) VALUES ('${did}', ${suspended}, now());`,
  );
  return { did, user };
}
const setState = (did: string, active: boolean, status: string | null) =>
  postgres.sql(
    "unset",
    `UPDATE idx.account SET pds_active = ${active}, pds_status = ${status === null ? "NULL" : `'${status}'`}
      WHERE did = '${did}'`,
  );
const dueFor = async (user: string) => (await locks.claim(100)).find((job) => job.user === user);
const refusedCode = async (sql: string) => {
  try {
    await withClient(web, null, (c) => c.query(sql));
    return "ok";
  } catch (error) {
    let at: unknown = error;
    while (at instanceof Error && (at as { code?: unknown }).code === undefined && at.cause !== undefined)
      at = at.cause;
    return String((at as { code?: unknown }).code);
  }
};

describe("chat lock store", () => {
  test.each([
    ["suspended at the PDS", { active: false, status: "suspended" }],
    ["deactivated", { active: false, status: "deactivated" }],
    ["taken down", { active: false, status: "takendown" }],
    ["suspended by a moderator", { active: true, status: null, suspended: true }],
  ])("chat.lock_due_%s: the ready chat account is due for a lock", async (_why, state) => {
    const { user } = member(state);
    const job = await dueFor(user);
    expect(job).toMatchObject({ lock: true, attempts: 0 });
    expect(await locks.settle(job as NonNullable<typeof job>)).toBe(true);
    expect(await dueFor(user)).toBeUndefined();
  });

  test("chat.lock_left_alone: an active member, one with no recorded state, or a pending chat account is not due", async () => {
    const active = member({ active: true, status: null });
    const unknown = member({ active: false, status: null });
    const pending = member({ active: false, status: "suspended", chat: "pending" });
    const due = (await locks.claim(100)).map((job) => job.user);
    for (const { user } of [active, unknown, pending]) expect(due).not.toContain(user);
  });

  test("chat.unlock_due: once the member is active again, the locked account is due for an unlock", async () => {
    const { did, user } = member({ active: false, status: "suspended" });
    const lock = await dueFor(user);
    await locks.settle(lock as NonNullable<typeof lock>);
    const parsed = parseChatUser(user);
    expect(await accounts.readyUser(did, AbortSignal.timeout(5000))).toBeNull();
    setState(did, true, null);
    const unlock = await dueFor(user);
    expect(unlock).toMatchObject({ lock: false });
    await locks.settle(unlock as NonNullable<typeof unlock>);
    expect(await accounts.readyUser(did, AbortSignal.timeout(5000))).toBe(parsed);
    expect(await dueFor(user)).toBeUndefined();
  });

  test("chat.lock_retry_fenced: a retry waits and counts; a spent lease settles nothing", async () => {
    const { user } = member({ active: false, status: "takendown" });
    const job = await dueFor(user);
    if (job === undefined) throw new Error("no job");
    // Claimed: not due again while the lease holds.
    expect(await dueFor(user)).toBeUndefined();
    expect(await locks.retry(job, 0)).toBe(true);
    const again = await dueFor(user);
    expect(again).toMatchObject({ lock: true, attempts: 1 });
    expect(await locks.settle(job)).toBe(false);
    expect(await locks.settle(again as NonNullable<typeof again>)).toBe(true);
  });

  test("chat.lock_web_bounds: web reads the account state only through the view", async () => {
    expect(await refusedCode("SELECT pds_status FROM idx.account")).toBe("42501");
    expect(await refusedCode("SELECT mod_suspended FROM mod.account_state")).toBe("42501");
  });
});
