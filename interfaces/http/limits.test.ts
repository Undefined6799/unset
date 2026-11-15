// P1.06p: this interface's policy table passes the kit's startup checks.
import { definePolicies } from "@unset/shared-http";
import { expect, test } from "vitest";
import { policies, policiesFor } from "./limits.ts";

test("tables_valid", () => {
  expect(definePolicies(policies)).toEqual(policies);
  expect(Object.keys(policies)).toContain("default");
});

// ADR 0042: behind the edge the server sees one address for everyone, so the table it runs has no per-address bucket.
test("socket_mode_has_no_per_address_bucket", () => {
  const table = policiesFor("socket");
  expect(Object.keys(table)).toEqual(Object.keys(policies));
  expect(Object.values(table).flatMap((policy) => policy.map((entry) => entry.scope))).not.toContain("ip");
  expect(table.default).toEqual([{ capacity: 3000, refillPerSec: 50, scope: "global" }]);
  expect(table.login).toEqual([{ capacity: 120, refillPerSec: 2, scope: "global" }]);
  expect(table.search).toEqual([{ capacity: 60, refillPerSec: 1, scope: "did" }]);
  expect(table.report).toEqual([{ capacity: 10, refillPerSec: 10 / 60, scope: "did" }]);
});

test("header_mode_keeps_the_per_address_table", () => {
  expect(policiesFor("header")).toBe(policies);
});
