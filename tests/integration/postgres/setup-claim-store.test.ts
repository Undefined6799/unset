// Build step 8 (infrastructure/postgres/setupClaimStore.ts, migration 0046; ADR 0095 decision 2, ADR 0100): the
// door's setup claim, against real Postgres connected as `chat_auth`, the door's own role (TE-2). One browser entry
// holds an account's setup at a time; its own claim is taken again; another's waits until the claim's time has
// passed; release frees it for others only from its holder; a race of many browsers has exactly one winner; and the
// claim goes with its browser entry.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { relative } from "node:path";
import type { Did } from "@unset/domains-identity";
import type { BrowserEntry, BrowserKey, ChatUser, DeviceId, LockKey, SessionRef } from "@unset/domains-messaging";
import {
  createBrowserListStore,
  createPool,
  createSetupClaimStore,
  type Pool,
  withClient,
} from "@unset/infrastructure-postgres";
import { createSealer, Keyring } from "@unset/infrastructure-seal";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.chat_auth, database, ssl: false };
const door: Pool = createPool({ connection, service: "setup-claim-store-test", max: 8, connectTimeoutMs: 5000 });
afterAll(() => door.end());

const list = createBrowserListStore(door, createSealer(new Keyring("k1", new Map([["k1", randomBytes(32)]]))));
const claims = createSetupClaimStore(door);
const deadline = () => AbortSignal.timeout(5000);
const SID = "s".repeat(43) as SessionRef;

let n = 0;
/** A browser signed in to the account `user` (a fresh chat user unless given), as the door's list keeps it. */
async function signedIn(user = newUser()): Promise<BrowserEntry> {
  const k = n++;
  const entry: BrowserEntry = {
    id: randomUUID(),
    did: `did:plc:${base32(24)}` as Did,
    user,
    device: `SET${String(k).padStart(7, "0")}` as DeviceId,
    lockKey: randomBytes(32) as unknown as LockKey,
  };
  const browser = createHash("sha256").update(randomBytes(32)).digest() as unknown as BrowserKey;
  expect(await list.add(browser, entry, SID, deadline())).toBe("added");
  return entry;
}
const base32 = (length: number) =>
  Array.from(randomBytes(length), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("");
const newUser = () => `u${base32(20)}` as ChatUser;

describe("setup claim store", () => {
  test("door.setup_claim_once: the first browser claims; a second browser of the account is refused", async () => {
    const a = await signedIn();
    const b = await signedIn(a.user);
    expect(await claims.claim(a, 600, deadline())).toBe("claimed");
    expect(await claims.claim(b, 600, deadline())).toBe("elsewhere");
  });

  test("door.setup_claim_again: the holder claims again; another account is not affected", async () => {
    const a = await signedIn();
    const other = await signedIn();
    expect(await claims.claim(a, 600, deadline())).toBe("claimed");
    expect(await claims.claim(a, 600, deadline())).toBe("claimed");
    expect(await claims.claim(other, 600, deadline())).toBe("claimed");
  });

  test("door.setup_claim_expired: once the claim's time has passed another browser takes it", async () => {
    const a = await signedIn();
    const b = await signedIn(a.user);
    // A claim of no length has passed by the next statement (now() is each statement's transaction start).
    expect(await claims.claim(a, 0, deadline())).toBe("claimed");
    expect(await claims.claim(b, 600, deadline())).toBe("claimed");
    expect(await claims.claim(a, 600, deadline())).toBe("elsewhere");
  });

  test("door.setup_release: only the holder's release frees the account", async () => {
    const a = await signedIn();
    const b = await signedIn(a.user);
    await claims.claim(a, 600, deadline());
    await claims.release(b, deadline());
    expect(await claims.claim(b, 600, deadline())).toBe("elsewhere");
    await claims.release(a, deadline());
    expect(await claims.claim(b, 600, deadline())).toBe("claimed");
  });

  test("door.setup_claim_race: of eight browsers claiming at once exactly one wins (rule DA-4)", async () => {
    const first = await signedIn();
    const rest = await Promise.all(Array.from({ length: 7 }, () => signedIn(first.user)));
    const outcomes = await Promise.all([first, ...rest].map((e) => claims.claim(e, 600, deadline())));
    expect(outcomes.filter((o) => o === "claimed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "elsewhere")).toHaveLength(7);
  });

  test("door.setup_claim_follows_entry: when the holder's entry is removed its claim goes with it", async () => {
    const a = await signedIn();
    const b = await signedIn(a.user);
    await claims.claim(a, 600, deadline());
    await list.remove(a, deadline());
    expect(await claims.claim(b, 600, deadline())).toBe("claimed");
  });

  test("door.setup_claim_scoped: a claim is only ever for the entry's own account", async () => {
    const a = await signedIn();
    await claims.claim(a, 600, deadline());
    const { rows } = await withClient(door, null, (db) =>
      db.query<{ chat_user: string; browser_id: string }>(
        "SELECT chat_user, browser_id::text AS browser_id FROM door.chat_setup WHERE chat_user = $1",
        [a.user],
      ),
    );
    expect(rows).toEqual([{ chat_user: a.user, browser_id: a.id }]);
  });
});
