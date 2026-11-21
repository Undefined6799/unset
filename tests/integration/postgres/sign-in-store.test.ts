// P2.27c (infrastructure/postgres/signInStore.ts, migration 0038, ADR 0082): the sign-in history against real Postgres,
// connected as `web` (TE-2). Every read and delete is scoped to the member; any of their browsers may delete any entry
// (Alex 2026-11-21 00:57Z), so the scoping by DID is what keeps one member's ids from another's rows.
import { relative } from "node:path";
import { type Did, PRIVACY_VERSION, type SignIn, type SignInId, TERMS_VERSION } from "@unset/domains-identity";
import {
  createAccountRepository,
  createOAuthSessionStore,
  createPool,
  createSignInStore,
  type Pool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";
import { chatAccountsOf } from "../../support/chat-accounts.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({ connection, service: "sign-in-store-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => web.end());

const store = createSignInStore();
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const accounts = createAccountRepository(web, {
  recordUnderageBlock: async () => {
    throw new Error("never blocks");
  },
  chatAccounts: chatAccountsOf(web),
});

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 4).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore({ pool: web, sealer: createSealer(keyring), log: quiet });

let dids = 0;
const nextDid = (): Did => {
  dids += 1; // one base32 letter per test DID; fewer than 32 here
  return `did:plc:${"h".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}` as Did;
};

/** A member with an account row (past the terms step). */
async function member(): Promise<Did> {
  const did = nextDid();
  const deadline = AbortSignal.timeout(5000);
  await accounts.confirmAdult(did, deadline);
  await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, deadline);
  await tokenSets.set(did, { authMethod: { method: "private_key_jwt", kid: "A" } }); // so its sessions may exist
  return did;
}

/** A browser signed in as `did`, with its sign-in recorded in the same transaction, as the OAuth callback does. */
async function signIn(did: Did): Promise<void> {
  await withTransaction(web, null, async (tx) => {
    await sessions.create(tx, did);
    await store.record(tx, did);
  });
  await new Promise((done) => setTimeout(done, 2)); // each sign-in after the last
}

const db = <T>(fn: (client: Parameters<Parameters<typeof withClient>[2]>[0]) => Promise<T>) =>
  withClient(web, null, fn);
const list = (did: Did, limit = 100): Promise<SignIn[]> => db((c) => store.list(c, did, limit));
const ids = (rows: readonly SignIn[]): SignInId[] => rows.map((row) => row.id);

describe("sign-in store", () => {
  test("sign_in.listed_newest_first_for_the_member_only", async () => {
    const [did, other] = [await member(), await member()];
    await signIn(did);
    await signIn(did);
    await signIn(other);
    const seen = await list(did);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.at.getTime()).toBeGreaterThan(seen[1]?.at.getTime() ?? 0);
    expect(await list(did, 1)).toEqual([seen[0]]);
    expect(await list(nextDid())).toEqual([]);
  });

  test("sign_in.no_account_row_means_nothing_is_kept", async () => {
    const did = nextDid(); // a first sign-in, before the terms step
    await db((c) => store.record(c, did));
    expect(await db((c) => c.query("SELECT 1 FROM app.sign_in WHERE did = $1", [did]))).toMatchObject({ rowCount: 0 });
  });

  test("sign_in.the_member_deletes_one_or_all_and_again_changes_nothing", async () => {
    const did = await member();
    await signIn(did);
    await signIn(did);
    await signIn(did);
    const [newest, ...older] = ids(await list(did));
    expect(await db((c) => store.remove(c, did, older))).toBe(2);
    expect(await db((c) => store.remove(c, did, older))).toBe(0);
    expect(await db((c) => store.remove(c, did, []))).toBe(0);
    expect(ids(await list(did))).toEqual([newest]);
    expect(await db((c) => store.removeUpTo(c, did, newest as SignInId))).toBe(1);
    expect(await db((c) => store.removeUpTo(c, did, newest as SignInId))).toBe(0);
    expect(await list(did)).toEqual([]);
  });

  test("sign_in.delete_all_spares_a_sign_in_after_the_page_was_drawn", async () => {
    const did = await member();
    await signIn(did);
    await signIn(did);
    const [drawnNewest] = ids(await list(did));
    await signIn(did); // someone signs in while the page is open
    expect(await db((c) => store.removeUpTo(c, did, drawnNewest as SignInId))).toBe(2);
    const [left] = ids(await list(did));
    expect(left).not.toBe(drawnNewest);
    expect(await list(did)).toHaveLength(1);
  });

  test("sign_in.another_members_ids_delete_nothing", async () => {
    const [alice, bob] = [await member(), await member()];
    await signIn(alice);
    await signIn(bob);
    const theirs = ids(await list(alice));
    expect(await db((c) => store.remove(c, bob, theirs))).toBe(0);
    expect(await db((c) => store.removeUpTo(c, bob, theirs[0] as SignInId))).toBe(0); // alice's id, bob's DID
    expect(ids(await list(alice))).toEqual(theirs);
  });

  test("sign_in.the_sweep_deletes_what_is_past_its_days", async () => {
    const did = await member();
    await signIn(did);
    await db((c) => store.sweep(c));
    expect(await list(did)).toHaveLength(1); // a fresh sign-in is inside 30 days
    await new Promise((done) => setTimeout(done, 2));
    expect(await db((c) => store.sweep(c, 0))).toBeGreaterThanOrEqual(1);
    expect(await list(did)).toEqual([]);
  });

  test("sign_in.web_may_not_backdate_or_edit_a_row", async () => {
    const did = await member();
    await expect(
      db((c) => c.query("INSERT INTO app.sign_in (did, signed_in_at) VALUES ($1, now())", [did])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db((c) => c.query("UPDATE app.sign_in SET signed_in_at = now() WHERE did = $1", [did])),
    ).rejects.toThrow(/permission denied/);
  });
});
