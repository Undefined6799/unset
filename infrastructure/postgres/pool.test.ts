// P1.11p: what the pool does before any server answers. Port 1 on loopback refuses every connection.
import { AppError } from "@unset/shared-errors";
import { describe, expect, test } from "vitest";
import { acquire, createPool } from "./pool.ts";

const unreachable = () =>
  createPool({
    connection: { host: "127.0.0.1", port: 1, database: "unset", user: "web", password: "x", ssl: false },
    service: "web",
    max: 2,
    connectTimeoutMs: 500,
    statementTimeoutMs: 2000,
    idleInTransactionTimeoutMs: 5000,
  });

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

describe("pool", () => {
  test("pool_is_lazy", async () => {
    const pool = unreachable();
    expect(pool.driver.totalCount).toBe(0);
    await pool.close();
  });

  test("fired_deadline_never_asks_the_pool", async () => {
    const pool = unreachable();
    const deadline = AbortSignal.abort();
    expect(await codeOf(acquire(pool, deadline))).toBe("http.deadline");
    expect(pool.driver.totalCount).toBe(0);
    await pool.close();
  });

  test("unreachable_server_is_db_busy", async () => {
    const pool = unreachable();
    const failure = await acquire(pool, null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe("db.busy");
    expect((failure as AppError).cause).toBeInstanceOf(Error);
    await pool.close();
  });
});
