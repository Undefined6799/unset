// The committed route manifest is the route table (P1.04, findings F-27): a new route or a changed option shows in
// the PR diff, where CODEOWNERS sends it to security review.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { loadConfig } from "@unset/shared-config";
import { createServer, defineRoute } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { expect, test } from "vitest";
import { compose } from "./compose.ts";
import { config } from "./config.ts";

const COMMIT = "c".repeat(40);
const ENV = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "http",
  UNSET_COMMIT: COMMIT,
  LISTEN_PORT: "8080",
  PUBLIC_ORIGIN: "https://unset.test",
  HTTP_ALLOWED_HOSTS: "unset.test",
};
type Entry = { method: string; path: string };
/** Each route keyed by "METHOD path", as JSON keeps it: an unset option is absent, as in the committed file. */
const byRoute = (routes: readonly Entry[]) =>
  Object.fromEntries(routes.map((r) => [`${r.method} ${r.path}`, JSON.parse(JSON.stringify(r)) as unknown]));
/** The routes whose table entry and committed entry differ, by "METHOD path"; empty when the manifest matches. */
const drift = (table: readonly Entry[], committed: readonly Entry[]): string[] => {
  const [a, b] = [byRoute(table), byRoute(committed)];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !isDeepStrictEqual(a[key], b[key]));
};
const manifest: Entry[] = JSON.parse(readFileSync(new URL("./routes.manifest.json", import.meta.url), "utf8"));

test("route_manifest_matches", async () => {
  const { server } = await compose(loadConfig(config, ENV));
  expect(drift(server.routeTable(), manifest)).toEqual([]);
});

test("route_manifest_names_an_extra_route", async () => {
  const cfg = loadConfig(config, ENV);
  const log = createLogger({ service: "http", commit: COMMIT, env: "test", write: () => undefined });
  const extra = defineRoute({
    method: "GET",
    path: "/extra",
    group: "app",
    rateLimit: "page",
    handler: () => new Response(),
  });
  const server = createServer({ config: cfg, routes: [extra], policies: { page: {} }, log });
  expect(drift(server.routeTable(), manifest)).toEqual(["GET /extra"]);
});
