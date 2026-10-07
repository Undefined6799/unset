// P1.30: env values the preflight reads never leave the map in any string form; they are reachable only through use().
import { inspect } from "node:util";
import { expect, test } from "vitest";
import { SecretMap } from "./secret-map.ts";

const CANARY = "canary-7f3c-never-printed";

test("secret_map_redacts", () => {
  const map = new SecretMap([["PDS_ADMIN_PASSWORD", CANARY]]);
  expect(JSON.stringify({ map })).toBe('{"map":"[redacted]"}');
  expect(`${map}`).toBe("[redacted]");
  expect(inspect(map)).toBe("[redacted]");
  expect(inspect({ nested: map }, { depth: 5 })).not.toContain(CANARY);
  expect(map.has("PDS_ADMIN_PASSWORD")).toBe(true);
  expect(map.use("PDS_ADMIN_PASSWORD", (v) => v?.length)).toBe(CANARY.length);
  expect(map.use("ABSENT", (v) => v)).toBeUndefined();
});
