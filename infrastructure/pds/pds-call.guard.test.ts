// P2.07: the credential is restored in one file. A planted source that calls client.restore or builds an Agent fails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const ALLOWED = "infrastructure/pds/pds-call.ts";
const SKIP = new Set(["node_modules", "dist", ".git", "tests"]);

/** True when `source` restores an OAuth session or constructs the XRPC Agent. */
export function buildsPdsClient(source: string): boolean {
  return source.includes("client.restore(") || (source.includes("@atproto/api") && source.includes("new Agent("));
}

function files(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.endsWith(".test.ts")) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...files(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

test("pdsCall.guard", () => {
  const offenders = files(ROOT)
    .map((path) => relative(ROOT, path))
    .filter((path) => path !== ALLOWED && buildsPdsClient(readFileSync(join(ROOT, path), "utf8")));
  expect(offenders).toEqual([]);
  expect(buildsPdsClient(readFileSync(join(ROOT, ALLOWED), "utf8"))).toBe(true);
  const planted = 'import { Agent } from "@atproto/api";\nclient.restore(did);\nnew Agent(session);\n';
  expect(buildsPdsClient(planted)).toBe(true);
});
