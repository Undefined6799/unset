// The store's decisions that need no database: which cookie values reach it, and how a failure surfaces. Its
// behaviour against real Postgres, as web, is tests/integration/session/store.test.ts.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { AppError } from "@unset/shared-errors";
import type { Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { createSessionStore, type WithSessionDb } from "./store.ts";

const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, logError: () => undefined };
const LIMITS = { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 };

function storeWith(withDb: WithSessionDb) {
  return createSessionStore({ withDb, limits: LIMITS, log });
}

describe("session store without a database", () => {
  test("session.only_issued_shapes_reach_the_database", async () => {
    let calls = 0;
    const store = storeWith(() => {
      calls++;
      return Promise.reject(new Error("never reached"));
    });
    // 43 characters, but the last carries bits a 32-byte value cannot have, so it was never issued.
    for (const value of ["", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}B`, `${"A".repeat(42)}.`]) {
      expect(await store.read({ key: {}, cookieValue: value, deadline: null })).toEqual({
        session: null,
        clearCookie: true,
      });
    }
    expect(await store.read({ key: {}, cookieValue: null, deadline: null })).toEqual({
      session: null,
      clearCookie: false,
    });
    expect(calls).toBe(0);
  });

  test("session.read_failure_is_503", async () => {
    const value = Buffer.alloc(32, 1).toString("base64url");
    const plain = storeWith(() => Promise.reject(new Error("connection reset")));
    const failed = await plain.read({ key: {}, cookieValue: value, deadline: null }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(AppError);
    expect(failed).toMatchObject({ code: "service.unavailable", status: 503 });
    // An AppError (the pool's db.busy, a deadline) passes through as it is.
    const busy = storeWith(() => Promise.reject(new AppError("db.busy")));
    await expect(busy.read({ key: {}, cookieValue: value, deadline: null })).rejects.toMatchObject({ code: "db.busy" });
  });

  test("session.create_writes_only_an_origin_the_column_accepts", async () => {
    // What create binds as issuer_origin: the caller's checked origin, or null for a shape migration 0019's check
    // refuses, so that check can never fail a sign-in (ADR 0048).
    const store = storeWith(() => Promise.reject(new Error("never reached")));
    const did = parseDid("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa") as Did;
    const written = async (options?: { issuerOrigin?: string | null }) => {
      let values: unknown[] = [];
      const db = {
        query: (text: string, bound: unknown[] = []) => {
          expect(text).toContain("issuer_origin");
          values = bound;
          return Promise.resolve({ rows: [{ expires_at: new Date(0) }] as never[], rowCount: 1 });
        },
      };
      await store.create(db, did, options);
      return values[3];
    };
    expect(await written({ issuerOrigin: "https://pds.example.com" })).toBe("https://pds.example.com");
    expect(await written({ issuerOrigin: `https://${"a".repeat(253)}` })).toBe(`https://${"a".repeat(253)}`);
    expect(await written()).toBeNull();
    expect(await written({ issuerOrigin: null })).toBeNull();
    for (const issuerOrigin of [
      "http://pds.example.com",
      "https://pds.example.com:8443",
      "https://pds.example.com/",
      "https://PDS.example.com",
      "https://under_score.example.com",
      "https://user@pds.example.com",
      "https://-pds.example.com",
      `https://${"a".repeat(254)}`,
      "https://pds.example.com\n",
      "https://pds.example.com\nhttps://evil.example",
      "",
    ]) {
      expect(await written({ issuerOrigin })).toBeNull();
    }
  });

  test("session.countLive_judges_on_the_callers_client_by_the_idle_limit", async () => {
    // The last browser's count (P2.08c) runs on the client the caller holds, so it sees that transaction's own delete,
    // and it binds the idle limit, never the touch interval (verify-1009 M3). Its rows against Postgres are pinned in
    // tests/integration/web/sign-out.test.ts.
    const store = storeWith(() => Promise.reject(new Error("never reached")));
    const did = parseDid("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa") as Did;
    const counted = (n: unknown) => {
      let values: unknown[] = [];
      const db = {
        query: (_text: string, bound: unknown[] = []) => {
          values = bound;
          return Promise.resolve({ rows: [{ n }] as never[], rowCount: 1 });
        },
      };
      return { result: store.countLive(db, did), values: () => values };
    };
    const two = counted(2);
    expect(await two.result).toBe(2);
    expect(two.values()).toEqual([did, LIMITS.idleS]);
    expect(await counted(0).result).toBe(0);
    // A count that is not a whole number fails, so a broken read never passes for "no browser left".
    for (const n of [undefined, null, -1, 1.5, "1"]) {
      await expect(counted(n).result).rejects.toThrow("session count missing");
    }
  });

  test("session.destroyAllForDid_requires_tx", () => {
    // The caller's transaction is a required argument, so ending the sessions commits with the caller's own change
    // (P2.12's block, P3.06's account state) or not at all. The check is the typecheck; nothing is called here.
    const store = storeWith(() => Promise.reject(new Error("never reached")));
    const did = parseDid("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa") as Did;
    // @ts-expect-error: no transaction passed
    const withoutTx = () => store.destroyAllForDid(did, "user_signout_all");
    expect(withoutTx).toBeTypeOf("function");
  });

  test("session.end_sessions_single_sql", () => {
    // One mechanism (phase-3 Notes): only the definer's migration deletes a DID's sessions; TypeScript calls it.
    // P2.03t (migration 0024, ADR 0049): the database also ends them when the DID's token set is deleted, through a
    // foreign key's cascade. That is no statement anyone writes, so this list is unchanged.
    const root = join(import.meta.dirname, "..", "..");
    const pattern = "DELETE FROM app[.]session WHERE did";
    const files = execFileSync("git", ["grep", "--untracked", "-l", "-i", "-E", pattern, "--", "*.ts", "*.sql"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(files.trim().split("\n")).toEqual(["infrastructure/postgres/migrations/0014_app_end_sessions.sql"]);
  });
});
