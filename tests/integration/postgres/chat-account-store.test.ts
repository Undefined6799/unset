// Build step 5 (infrastructure/postgres/chatAccountStore.ts, migration 0043; ADR 0010, ADR 0093 decision 3): the DID to
// chat user mapping and its queued "create chat account" job, against real Postgres connected as `web` (TE-2). The
// row is written with the terms acceptance or not at all; a claim is fenced by its lease; reads are by the caller's DID.
import { randomBytes } from "node:crypto";
import { relative } from "node:path";
import { type Did, PRIVACY_VERSION, TERMS_VERSION } from "@unset/domains-identity";
import { type ChatUser, newChatUser } from "@unset/domains-messaging";
import {
  createAccountRepository,
  createChatAccountStore,
  createPool,
  type Pool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({ connection, service: "chat-account-store-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => web.end());

const drawn: ChatUser[] = [];
const store = createChatAccountStore(web, {
  newUser: () => {
    const user = newChatUser((n) => randomBytes(n));
    drawn.push(user);
    return user;
  },
  leaseS: 60,
});
const accounts = createAccountRepository(web, {
  recordUnderageBlock: async () => {
    throw new Error("never blocks");
  },
  chatAccounts: store,
});

let dids = 0;
const nextDid = (): Did => {
  dids += 1; // one base32 letter per test DID; fewer than 32 here
  return `did:plc:${"r".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}` as Did;
};
const deadline = () => AbortSignal.timeout(5000);

/** A member at the terms step, and then past it when `accept`. */
async function member(accept = true): Promise<Did> {
  const did = nextDid();
  await accounts.confirmAdult(did, deadline());
  if (accept) await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, deadline());
  return did;
}

const rowOf = async (did: Did) =>
  withClient(web, null, async (db) => {
    const { rows } = await db.query<{ chat_user: string; state: string; attempts: number; lease_token: string | null }>(
      "SELECT chat_user, state, attempts, lease_token FROM app.chat_account WHERE did = $1",
      [did],
    );
    return rows[0];
  });

/** Makes every row due now, so a claim finds the ones a test means and leaves the others to their own time. */
const dueNow = (did: Did) =>
  withClient(web, null, (db) => db.query("UPDATE app.chat_account SET due_at = now() WHERE did = $1", [did]));
const claimFor = async (did: Did) => {
  await dueNow(did);
  const jobs = await store.claim(100);
  return jobs.find((job) => job.did === did);
};

describe("chat account store", () => {
  test("chat.terms_queue_create: accepting the terms writes the mapping, pending, in the same transaction", async () => {
    const did = await member();
    const row = await rowOf(did);
    expect(row).toMatchObject({ state: "pending", attempts: 0, lease_token: null });
    expect(row?.chat_user).toMatch(/^u[a-z2-7]{20}$/);
    expect(row?.chat_user).not.toContain(did.slice(8, 14));
  });

  test("chat.no_row_before_terms: a member who has not accepted the terms has no chat user", async () => {
    expect(await rowOf(await member(false))).toBeUndefined();
  });

  test("chat.rollback_leaves_nothing: a terms transaction that fails writes no mapping", async () => {
    const did = await member(false);
    await expect(
      withTransaction(web, null, async (tx) => {
        await store.request(tx, did);
        throw new Error("the rest of the transaction failed");
      }),
    ).rejects.toThrow("the rest of the transaction failed");
    expect(await rowOf(did)).toBeUndefined();
  });

  test("chat.user_never_changes: accepting new terms again keeps the first chat user", async () => {
    const did = await member();
    const first = (await rowOf(did))?.chat_user;
    await accounts.acceptTerms(did, TERMS_VERSION, "2099-01-01", deadline());
    await withTransaction(web, null, (tx) => store.request(tx, did));
    expect((await rowOf(did))?.chat_user).toBe(first);
  });

  test("chat.claim_leased: a claimed job is not claimed again while its lease holds", async () => {
    const did = await member();
    const job = await claimFor(did);
    expect(job).toMatchObject({ did, attempts: 0 });
    expect(job?.user).toBe((await rowOf(did))?.chat_user);
    expect((await store.claim(100)).some((other) => other.did === did)).toBe(false);
  });

  test("chat.settle_ready: the lease holder marks it ready, and only a ready user is read back", async () => {
    const did = await member();
    expect(await store.readyUser(did, deadline())).toBeNull();
    const job = await claimFor(did);
    if (job === undefined) throw new Error("no claim");
    expect(await store.settle(job, { state: "ready" })).toBe(true);
    expect(await rowOf(did)).toMatchObject({ state: "ready", lease_token: null });
    expect(await store.readyUser(did, deadline())).toBe(job.user);
    expect(await store.readyUser(nextDid(), deadline())).toBeNull();
  });

  test("chat.settle_retry: a retry counts the attempt and waits", async () => {
    const did = await member();
    const job = await claimFor(did);
    if (job === undefined) throw new Error("no claim");
    expect(await store.settle(job, { state: "pending", retryInS: 600 })).toBe(true);
    expect(await rowOf(did)).toMatchObject({ state: "pending", attempts: 1, lease_token: null });
    expect((await store.claim(100)).some((other) => other.did === did)).toBe(false);
  });

  test("chat.stale_lease_writes_nothing: a worker whose lease was taken over settles nothing", async () => {
    const did = await member();
    const stale = await claimFor(did);
    const fresh = await claimFor(did); // the first lease lapsed (forced here) and another worker claimed it
    if (stale === undefined || fresh === undefined) throw new Error("no claim");
    expect(fresh.lease).not.toBe(stale.lease);
    expect(await store.settle(stale, { state: "failed" })).toBe(false);
    expect(await rowOf(did)).toMatchObject({ state: "pending" });
    expect(await store.settle(fresh, { state: "ready" })).toBe(true);
  });

  test("chat.web_cannot_delete: web holds no delete on the mapping", async () => {
    const did = await member();
    await expect(
      withClient(web, null, (db) => db.query("DELETE FROM app.chat_account WHERE did = $1", [did])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
