// P1.06p: this interface's policy table passes the kit's startup checks.
import { definePolicies } from "@unset/shared-http";
import { expect, test } from "vitest";
import { policies } from "./limits.ts";

test("tables_valid", () => {
  expect(definePolicies(policies)).toEqual(policies);
  expect(Object.keys(policies)).toContain("default");
});
