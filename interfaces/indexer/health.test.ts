import { createServer, type Server } from "node:http"; // guard-allow: egress test listener on loopback only
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { type HealthRead, healthListener } from "./health.ts";

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve()))));

async function serve(read: HealthRead): Promise<string> {
  server = createServer(healthListener(read));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("indexer health", () => {
  test("health.answers_the_counts_as_json", async () => {
    const origin = await serve(async () => ({ enabled: true, ticks: 3 }));
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ enabled: true, ticks: 3 });
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
    const origin = await serve(async () => ({}));
    expect((await fetch(`${origin}/`)).status).toBe(404);
    expect((await fetch(`${origin}/health`, { method: "POST" })).status).toBe(404);
  });
});
