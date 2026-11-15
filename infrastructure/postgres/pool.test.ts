// P1.11p: what the pool does before any server answers. Port 1 on loopback refuses every connection.
import { AppError } from "@unset/shared-errors";
import { describe, expect, test } from "vitest";
import { acquire, createPool, type Pool, ping } from "./pool.ts";

const unreachable = () =>
  createPool({
    connection: { host: "127.0.0.1", port: 1, database: "unset", user: "web", password: "x", ssl: false },
    service: "web",
    max: 2,
    connectTimeoutMs: 500,
  });

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

describe("pool", () => {
  test("pool_is_lazy", async () => {
    const pool = unreachable();
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  test("fired_deadline_never_asks_the_pool", async () => {
    const pool = unreachable();
    const deadline = AbortSignal.abort();
    expect(await codeOf(acquire(pool, deadline))).toBe("http.deadline");
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  test("unreachable_server_is_db_busy", async () => {
    const pool = unreachable();
    const failure = await acquire(pool, null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe("db.busy");
    expect((failure as AppError).cause).toBeInstanceOf(Error);
    await pool.end();
  });
});

// P1.04x: the readiness probe. The signal bounds the wait for a client and the query itself.
describe("ping", () => {
  test("ping_resolves_when_postgres_answers", async () => {
    const sent: string[] = [];
    const client = {
      query: (text: string) => {
        sent.push(text);
        return Promise.resolve({ rows: [] });
      },
      release: () => undefined,
    };
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    await expect(ping(pool, AbortSignal.timeout(1000))).resolves.toBeUndefined();
    expect(sent).toEqual(["SELECT 1"]);
  });

  test("ping_ends_a_silent_connection_at_the_deadline", async () => {
    // A connection that stops answering used to keep its client until the role's statement_timeout (Codex on #1531).
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
    expect(await codeOf(ping(pool, AbortSignal.timeout(30)))).toBe("http.deadline");
    expect(order).toEqual(["end", "release"]);
  });
});
