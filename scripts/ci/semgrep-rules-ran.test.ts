import { expect, test } from "vitest";
import { rulesRan } from "./semgrep-rules-ran.ts";

const sarif = (rules: number) =>
  JSON.stringify({
    runs: [
      {
        tool: {
          driver: { semanticVersion: "1.178.0", rules: Array.from({ length: rules }, (_, i) => ({ id: `r${i}` })) },
        },
      },
    ],
  });

test("semgrep_rules_counted", () => {
  expect(rulesRan(sarif(3))).toEqual({ rules: 3, version: "1.178.0" });
});

test("semgrep_zero_rules_detected", () => {
  expect(rulesRan(sarif(0)).rules).toBe(0);
  expect(rulesRan(JSON.stringify({ runs: [] })).rules).toBe(0);
});
