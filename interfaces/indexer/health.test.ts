import { createServer, type Server } from "node:http"; // guard-allow: egress test listener on loopback only
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { type HealthRead, healthListener, sharedRead } from "./health.ts";

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve()))));

async function serve(read: HealthRead): Promise<string> {
  server = createServer(healthListener(read));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("indexer health", () => {
  test("health.answers_the_counts_as_json", async () => {
    const origin = await serve(async () => ({ healthy: true, enabled: true, ticks: 3 }));
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ healthy: true, enabled: true, ticks: 3 });
  });

  test("health.unhealthy_is_503_with_the_counts", async () => {
    const origin = await serve(async () => ({ healthy: false, stream: { stops: 9 } }));
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ healthy: false, stream: { stops: 9 } });
  });

  test("health.one_read_is_shared_for_the_window", async () => {
    let clock = 0;
    let reads = 0;
    const read = sharedRead(
      async () => {
        reads += 1;
        if (reads === 2) throw new Error("database down");
        return { healthy: true, reads };
      },
      5000,
      () => clock,
    );
    await Promise.all([read(), read(), read()]);
    expect(reads).toBe(1);
    clock = 5000;
    await expect(read()).rejects.toThrow();
    await expect(read()).rejects.toThrow(); // a failure is shared too, so a flood cannot retry it
    expect(reads).toBe(2);
    clock = 10_000;
    expect(await read()).toEqual({ healthy: true, reads: 3 });
  });

  test("health.a_failed_read_is_503_with_no_detail", async () => {
    const origin = await serve(async () => {
      throw new Error("did:plc:secret could not be read");
    });
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });

  test("health.only_get_health_is_served", async () => {
    const origin = await serve(async () => ({ healthy: true }));
    expect((await fetch(`${origin}/`)).status).toBe(404);
    expect((await fetch(`${origin}/health`, { method: "POST" })).status).toBe(404);
  });
});
