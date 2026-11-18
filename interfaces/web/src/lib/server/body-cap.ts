// adapter-node's one body cap (BODY_SIZE_LIMIT, read when its handler loads; adapter-node 6.0.2 files/handler.js)
// must let the largest route's body through, or that route can never be used: the README card on /[did] takes up to
// 1 MiB while HTTP_BODY_LIMIT_BYTES is 64 KB. Each route's own limit stays the gate's (hooks.server.ts
// requestProblem): it refuses a declared Content-Length above the route's maxBody and a body with none, and SvelteKit
// stops reading past the declared length (kit 3.2.0 src/exports/node/index.js get_raw_body), so no route reads more
// than its own maxBody. server.ts loads the same policy.ts files the build's route table globs (route-table.ts).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RoutePolicy } from "./policy.ts";

/** The largest maxBody of `policies`; 0 when no route takes a body, so the cap refuses every body. */
export function largestMaxBody(policies: Iterable<RoutePolicy>): number {
  let largest = 0;
  for (const policy of policies) largest = Math.max(largest, policy.maxBody ?? 0);
  return largest;
}

/** Every route's policy, from each policy.ts under `routes` (src/routes). */
export async function routePolicies(routes: string): Promise<RoutePolicy[]> {
  const files = readdirSync(routes, { recursive: true, encoding: "utf8" }).filter(
    (file) => file === "policy.ts" || file.endsWith("/policy.ts"),
  );
  const loaded = await Promise.all(
    files.map(async (file) => (await import(pathToFileURL(join(routes, file)).href)) as { policy: RoutePolicy }),
  );
  return loaded.map((mod) => mod.policy);
}
