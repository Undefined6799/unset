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

// P1.30w (record 2026-10-12-c18-follow-ups, ruling N1): what the runner's scrub replaces.
test("secret_map_scrubs_only_what_was_read", () => {
  const map = new SecretMap([
    ["HOST", "pds.example.test"],
    ["UPSTREAM", "pds.example.test:3000"],
    ["EMPTY", ""],
    ["UNREAD", "unread-value"],
  ]);
  const text = "pds.example.test:3000 and pds.example.test, unread-value";
  for (const name of ["HOST", "UPSTREAM", "EMPTY", "NONE"]) map.use(name, () => undefined);
  // The longer value goes first, so the upstream is named whole; an empty, absent or unread value is left alone.
  expect(map.scrubReads(text)).toBe("UPSTREAM and HOST, unread-value");
  expect(map.holdsRead(map.scrubReads(text))).toBe(false);
  expect(map.holdsRead(text)).toBe(true);
  map.forgetReads();
  expect(map.scrubReads(text)).toBe(text);
});
