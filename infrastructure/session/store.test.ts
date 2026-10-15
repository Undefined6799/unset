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
    const root = join(import.meta.dirname, "..", "..");
    const pattern = "DELETE FROM app[.]session WHERE did";
    const files = execFileSync("git", ["grep", "--untracked", "-l", "-i", "-E", pattern, "--", "*.ts", "*.sql"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(files.trim().split("\n")).toEqual(["infrastructure/postgres/migrations/0014_app_end_sessions.sql"]);
  });
});
