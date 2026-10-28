// P1.36y (sign-in-lock.ts): a sign-in or a last-browser sign-out holds its account's OAuth lock from first use to its
// end, the library's lock calls inside reuse it, and the library's delete of the old set never leaves a gap.
// The lock and the store are doubles of Postgres (unmanaged here); tests/integration/http covers the real ones.
import { describe, expect, test } from "vitest";
import { createSignInLock, type NamedLock, type TokenSetStore } from "./sign-in-lock.ts";

const DID = `did:plc:${"a".repeat(24)}`;
const NAME = `@atproto-oauth-client-${DID}`;

/** A store that records every call, and a lock that queues callers and records when it is held. */
function world(options: { failSet?: boolean } = {}) {
  const rows = new Map<string, string>([[DID, "old"]]);
  const log: string[] = [];
  const store: TokenSetStore<string> = {
    get: async (did) => {
      log.push("get");
      return rows.get(did);
    },
    set: async (did, value) => {
      if (options.failSet === true) throw new Error("write timed out");
      log.push(`set ${value}`);
      rows.set(did, value);
    },
    del: async (did) => {
      log.push("del");
      rows.delete(did);
    },
  };
  let queue = Promise.resolve();
  const lock: NamedLock = (name, fn) => {
    const run = queue.then(async () => {
      log.push(name === NAME ? "lock" : `lock ${name}`);
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
  return { rows, log, ...createSignInLock({ store, lock }) };
}

describe("signInLock", () => {
  test("outside_a_sign_in_the_store_and_lock_are_unchanged", async () => {
    const { log, rows, tokenSets, requestLock } = world();
    await requestLock(NAME, () => tokenSets.get(DID));
    await tokenSets.del(DID);
    expect(log).toEqual(["lock", "get", "unlock", "del"]);
    expect(rows.has(DID)).toBe(false);
  });

  test("the_old_set_is_replaced_without_a_gap", async () => {
    // @atproto/oauth-client 0.8.9 callback: revoke (getSession under requestLock, delStored) then setStored.
    const { log, rows, tokenSets, requestLock, during } = world();
    const seen: (string | undefined)[] = [];
    await during(async () => {
      await requestLock(NAME, () => tokenSets.get(DID));
      await tokenSets.del(DID);
      seen.push(rows.get(DID));
      await tokenSets.set(DID, "new");
    });
    expect(seen).toEqual(["old"]);
    expect(rows.get(DID)).toBe("new");
    expect(log).toEqual(["lock", "get", "set new", "unlock"]);
  });

  test("lock_calls_inside_a_scope_reuse_the_held_lock", async () => {
    // Codex review on #1441: a second lock from the same bounded pool inside the scope could wait on itself.
    const { log, tokenSets, requestLock, during } = world();
    await during(async () => {
      await requestLock(NAME, () => tokenSets.get(DID));
      await tokenSets.set(DID, "new");
      await requestLock(NAME, () => tokenSets.get(DID));
    });
    expect(log).toEqual(["lock", "get", "set new", "get", "unlock"]);
  });

  test("a_delete_with_no_set_after_it_runs_when_the_sign_in_ends", async () => {
    const { log, rows, tokenSets, during } = world();
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

  test("a_failed_write_keeps_the_pending_delete", async () => {
    // Codex review on #1441: the old, revoked set must not outlive a replacement that was never stored.
    const { log, rows, tokenSets, during } = world({ failSet: true });
    await expect(
      during(async () => {
        await tokenSets.del(DID);
        await tokenSets.set(DID, "new");
      }),
    ).rejects.toThrow("write timed out");
    expect(rows.has(DID)).toBe(false);
    expect(log).toEqual(["lock", "del", "unlock"]);
  });

  test("a_sign_out_waits_for_the_sign_in_to_finish", async () => {
    const { log, tokenSets, during, exclusive } = world();
    let finish = (): void => undefined;
    const signIn = during(async () => {
      await tokenSets.set(DID, "new");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      log.push("session row");
    });
    await Promise.resolve();
    const signOut = exclusive(DID, async () => {
      log.push("sign-out count");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    finish();
    await Promise.all([signIn, signOut]);
    expect(log).toEqual(["lock", "set new", "session row", "unlock", "lock", "sign-out count", "unlock"]);
  });

  test("a_sign_out_revokes_under_its_own_lock", async () => {
    // OAuthClient.revoke reads under requestLock and deletes in a finally (dist/oauth-client.js:248-268).
    const { log, rows, tokenSets, requestLock, exclusive } = world();
    await exclusive(DID, async () => {
      await requestLock(NAME, () => tokenSets.get(DID));
      await tokenSets.del(DID);
    });
    expect(rows.has(DID)).toBe(false);
    expect(log).toEqual(["lock", "get", "del", "unlock"]);
  });

  test("one_scope_holds_one_account", async () => {
    const { tokenSets, during } = world();
    await expect(
      during(async () => {
        await tokenSets.set(DID, "new");
        await tokenSets.set(`did:plc:${"b".repeat(24)}`, "other");
      }),
    ).rejects.toThrow(/one account/);
  });
});
