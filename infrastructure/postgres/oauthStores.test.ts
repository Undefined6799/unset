// P2.08h: the sealed stores pass GetOptions.signal through to the pool (@atproto-labs/simple-store 0.5.1).
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import type { Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { createOAuthSessionStore, createOAuthStateStore } from "./oauthStores.ts";
import type { Pool } from "./pool.ts";

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const sealer = createSealer(keyring);
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, logError: () => undefined };
const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";

describe("oauth stores", () => {
  test("get_passes_an_aborted_signal", async () => {
    let connects = 0;
    const pool = {
      connect: () => {
        connects += 1;
        return Promise.reject(new Error("should not connect"));
      },
    } as unknown as Pool;
    const signal = AbortSignal.abort();
    const session = createOAuthSessionStore({ pool, sealer, log });
    const state = createOAuthStateStore({ pool, sealer, log });
    await expect(session.get(DID, { signal })).rejects.toMatchObject({ code: "http.deadline" });
    await expect(state.get("state-1", { signal })).rejects.toMatchObject({ code: "http.deadline" });
    expect(connects).toBe(0);
  });

  test("get_ends_a_checked_out_query_on_abort", async () => {
    // The deadline used to stop waiting while the SELECT still held its client (Codex on #1285). end() runs first,
    // and the rejection is observed only after release, so the next checkout is not behind that query.
    const order: string[] = [];
    let rejectQuery: (error: Error) => void = () => undefined;
    const client = {
      query: () =>
        new Promise<never>((_resolve, reject) => {
          rejectQuery = reject;
        }),
      end: () => {
        order.push("end");
        rejectQuery(new Error("Connection terminated"));
        return Promise.resolve();
      },
      release: () => {
        order.push("release");
      },
    };
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    const session = createOAuthSessionStore({ pool, sealer, log });
    const pending = session.get(DID, { signal: AbortSignal.timeout(30) });
    await expect(pending).rejects.toMatchObject({ code: "http.deadline" });
    expect(order).toEqual(["end", "release"]);
  });
});
