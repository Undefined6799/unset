// body-cap.ts: adapter-node's cap is the largest maxBody of the real route table, read from the policy.ts files the
// build globs, so a route's limit can never sit above what the process lets through.
import { join } from "node:path";
import { expect, test } from "vitest";
import { largestMaxBody, routePolicies } from "./body-cap.ts";

test("the_cap_is_the_largest_route_body", () => {
  const policies = [{ maxBody: 1_024 }, {}, { maxBody: 1_048_576 }, { maxBody: 2_048 }];
  expect(largestMaxBody(policies as never)).toBe(1_048_576);
});

test("no_route_that_takes_a_body_means_no_body_at_all", () => {
  expect(largestMaxBody([{}] as never)).toBe(0);
});

test("every_policy_file_is_read_and_the_profile_page_sets_the_cap", async () => {
  const policies = await routePolicies(join(import.meta.dirname, "..", "..", "routes"));
  expect(policies.length).toBeGreaterThan(10);
  expect(largestMaxBody(policies)).toBeGreaterThan(64 * 1024);
});
