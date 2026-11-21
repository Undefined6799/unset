// The erased members' chat accounts (infrastructure/postgres/chatErasureStore.ts, migrations 0042 and 0047; ADR 0096
// decision 3), against real Postgres connected as `web` (TE-2). core.erase_did, run as its owner as erasure runs,
// queues the chat user with no DID; web claims it under a lease, deletes it once chat-admin has deactivated the
// account, or puts it back with a wait. web can neither add a row nor read anything but the queue's own columns.
import { join } from "node:path";
import { createChatErasureStore, type Pool, withClient } from "@unset/infrastructure-postgres";
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
const pools = testPools("chat-erasure-store-test");
const migratorPassword = randomPassword();
const webPassword = randomPassword();
let postgres: PostgresContainer;
let web: Pool;
let migrator: Pool;
let store: ReturnType<typeof createChatErasureStore>;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE web PASSWORD '${webPassword}'`);
  web = pools.open(postgres, "unset", "web", webPassword, { max: 2 });
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
  store = createChatErasureStore(web, { leaseS: 60 });
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

let n = 0;
/** A member with a chat account, erased as erasure runs it: the chat user is all that is left of them. */
async function erased(): Promise<string> {
  n += 1;
  const letter = "abcdefghijklmnopqrstuvwxyz"[n] ?? "z";
  const did = `did:plc:${letter.repeat(24)}`;
  const user = `u${letter.repeat(20)}`;
  postgres.sql(
    "unset",
    `INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ('${did}', now(), 'done');
     INSERT INTO app.chat_account (did, chat_user, state) VALUES ('${did}', '${user}', 'ready');`,
  );
  await withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'account_deleted')", [did]));
  return user;
}
const queued = () =>
  postgres.sql("unset", "SELECT chat_user FROM app.chat_erasure ORDER BY 1").split("\n").filter(Boolean);
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

describe("chat erasure store", () => {
  test("chat.erasure_claim_finish: an erased member's chat user is claimed, and goes once finished", async () => {
    const user = await erased();
    const [job] = await store.claim(10);
    expect(job).toMatchObject({ user, attempts: 0 });
    // Claimed: not due again while the lease holds.
    expect(await store.claim(10)).toEqual([]);
    expect(await store.finish(job as NonNullable<typeof job>)).toBe(true);
    expect(queued()).not.toContain(user);
  });

  test("chat.erasure_retry: a failed call puts the row back with one more attempt and a wait", async () => {
    const user = await erased();
    const [job] = await store.claim(10);
    if (job === undefined) throw new Error("no job");
    expect(await store.retry(job, 0)).toBe(true);
    const [again] = await store.claim(10);
    expect(again).toMatchObject({ user, attempts: 1 });
    expect(again?.lease).not.toBe(job.lease);
    // The first lease is spent: its holder can no longer settle the row.
    expect(await store.finish(job)).toBe(false);
    expect(await store.finish(again as NonNullable<typeof again>)).toBe(true);
  });

  test("chat.erasure_age: a claim says how long ago the erasure queued the row, by the database's clock", async () => {
    const user = await erased();
    postgres.sql(
      "unset",
      `UPDATE app.chat_erasure SET queued_at = now() - interval '200 seconds' WHERE chat_user = '${user}'`,
    );
    const job = (await store.claim(10)).find((j) => j.user === user);
    expect(job?.queuedForS).toBeGreaterThanOrEqual(200);
    expect(job?.queuedForS).toBeLessThan(260);
    await store.finish(job as NonNullable<typeof job>);
  });

  test("chat.erasure_web_bounds: web may not add a row, nor change who is queued", async () => {
    expect(
      await refusedCode(`INSERT INTO app.chat_erasure (chat_user, queued_at) VALUES ('u${"y".repeat(20)}', now())`),
    ).toBe("42501");
    expect(await refusedCode(`UPDATE app.chat_erasure SET chat_user = 'u${"y".repeat(20)}'`)).toBe("42501");
  });
});
