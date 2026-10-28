// P1.36y (sign-in-lock.ts): a sign-in holds its account's lock from its first token-set write until its session row
// exists, and the library's delete of the old set inside it never leaves a gap that another browser can see.
// The lock and the store are doubles of Postgres (unmanaged here); tests/integration/http covers the real ones.
import { describe, expect, test } from "vitest";
import { createSignInLock, type DidLock, type TokenSetStore } from "./sign-in-lock.ts";

const DID = `did:plc:${"a".repeat(24)}`;

/** A store that records every call, and a lock that records when it is held and lets a test hold it from outside. */
function world() {
  const rows = new Map<string, string>([[DID, "old"]]);
  const log: string[] = [];
  const store: TokenSetStore<string> = {
    get: async (did) => {
      log.push(`get ${did === DID ? "" : did}`.trim());
      return rows.get(did);
    },
    set: async (did, value) => {
      log.push(`set ${value}`);
      rows.set(did, value);
    },
    del: async (did) => {
      log.push("del");
      rows.delete(did);
    },
  };
  let queue = Promise.resolve();
  const lockDid: DidLock = (did, fn) => {
    const run = queue.then(async () => {
      log.push(`lock ${did === DID ? "" : did}`.trim());
      try {
        return await fn();
      } finally {
        log.push("unlock");
      }
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return { rows, log, store, lockDid };
}

describe("signInLock", () => {
  test("outside_a_sign_in_the_store_is_unchanged", async () => {
    const { log, store, lockDid, rows } = world();
    const { tokenSets } = createSignInLock({ store, lockDid });
    await tokenSets.get(DID);
    await tokenSets.del(DID);
    expect(log).toEqual(["get", "del"]);
    expect(rows.has(DID)).toBe(false);
  });

  test("the_old_set_is_replaced_without_a_gap", async () => {
    // @atproto/oauth-client 0.8.9 callback: revoke (get, delStored) then setStored (dist/oauth-client.js:196-211).
    const { log, store, lockDid, rows } = world();
    const { tokenSets, during } = createSignInLock({ store, lockDid });
    const seen: (string | undefined)[] = [];
    await during(async () => {
      await tokenSets.get(DID);
      await tokenSets.del(DID);
      seen.push(rows.get(DID));
      await tokenSets.set(DID, "new");
    });
    expect(seen).toEqual(["old"]);
    expect(rows.get(DID)).toBe("new");
    expect(log).toEqual(["get", "lock", "set new", "unlock"]);
  });

  test("a_delete_with_no_set_after_it_runs_when_the_sign_in_ends", async () => {
    const { log, store, lockDid, rows } = world();
    const { tokenSets, during } = createSignInLock({ store, lockDid });
    await expect(
      during(async () => {
        await tokenSets.set(DID, "new");
        await tokenSets.del(DID);
        throw new Error("refused after storing");
      }),
    ).rejects.toThrow("refused after storing");
    expect(rows.has(DID)).toBe(false);
    expect(log).toEqual(["lock", "set new", "del", "unlock"]);
  });

  test("a_sign_out_waits_for_the_sign_in_to_finish", async () => {
    const { log, store, lockDid } = world();
    const { tokenSets, during } = createSignInLock({ store, lockDid });
    let finish = (): void => undefined;
    const signIn = during(async () => {
      await tokenSets.set(DID, "new");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      log.push("session row");
    });
    await Promise.resolve();
    const signOut = lockDid(DID, async () => {
      log.push("sign-out count");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    finish();
    await Promise.all([signIn, signOut]);
    expect(log).toEqual(["lock", "set new", "session row", "unlock", "lock", "sign-out count", "unlock"]);
  });

  test("one_sign_in_holds_one_account", async () => {
    const { store, lockDid } = world();
    const { tokenSets, during } = createSignInLock({ store, lockDid });
    await expect(
      during(async () => {
        await tokenSets.set(DID, "new");
        await tokenSets.set(`did:plc:${"b".repeat(24)}`, "other");
      }),
    ).rejects.toThrow(/one account/);
  });
});
