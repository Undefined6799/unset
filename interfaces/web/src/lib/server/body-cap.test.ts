// body-cap.ts: adapter-node's cap is the largest maxBody in the real route table. The test reads every policy.ts the
// build globs (route-table.ts), so a route whose limit sits above the cap, or a cap above every route, fails here.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { BODY_CAP } from "./body-cap.ts";
import type { RoutePolicy } from "./policy.ts";

async function routePolicies(): Promise<RoutePolicy[]> {
  const routes = join(import.meta.dirname, "..", "..", "routes");
  const files = readdirSync(routes, { recursive: true, encoding: "utf8" }).filter(
    (file) => file === "policy.ts" || file.endsWith("/policy.ts"),
  );
  const loaded = await Promise.all(
    files.map(async (file) => (await import(pathToFileURL(join(routes, file)).href)) as { policy: RoutePolicy }),
  );
  return loaded.map((mod) => mod.policy);
}

test("the_cap_is_the_largest_route_body", async () => {
  const policies = await routePolicies();
  expect(policies.length).toBeGreaterThan(10);
  const largest = Math.max(...policies.map((policy) => policy.maxBody ?? 0));
  expect(largest).toBeGreaterThan(64 * 1024);
  expect(BODY_CAP).toBe(largest);
});
