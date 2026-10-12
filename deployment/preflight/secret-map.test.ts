// P1.30: env values the preflight reads never leave the map in any string form; they are reachable only through use().
import { inspect } from "node:util";
import { expect, test } from "vitest";
import { ConfiguredValues, SecretMap } from "./secret-map.ts";

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

// P1.30m (record 2026-10-12-p130m-preflight-withhold): what the runner asks of the run's values, and nothing more.
test("configured_values_answer_only_whether_text_holds_one", () => {
  const values = new ConfiguredValues(["pds.example.test", "", CANARY]);
  expect(values.occurIn("host pds.example.test:3000")).toBe(true);
  expect(values.occurIn(`x${CANARY}x`)).toBe(true);
  // An empty value is never recorded, or every reason would hold it.
  expect(values.occurIn("no value here")).toBe(false);
  expect(JSON.stringify({ values })).toBe('{"values":"[redacted]"}');
  expect(`${values}`).toBe("[redacted]");
  expect(inspect({ nested: values }, { depth: 5 })).not.toContain(CANARY);
});
