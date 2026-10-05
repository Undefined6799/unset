import { expect, test } from "vitest";
import { declaredRuleIds, missingCustomRules, rulesRan } from "./semgrep-rules-ran.ts";

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

const sarifWith = (ids: string[]) =>
  JSON.stringify({ runs: [{ tool: { driver: { rules: ids.map((id) => ({ id })) } } }] });

test("semgrep_custom_rules_loaded", () => {
  // Local rule ids arrive prefixed with their config path; registry rules are counted but never stand in for ours.
  const ids = ["computed-import", "floating-promises"];
  expect(missingCustomRules(sarifWith([".semgrep.rules.computed-import", "rules.floating-promises"]), ids)).toEqual([]);
  expect(missingCustomRules(sarifWith(["typescript.react.x", ".semgrep.rules.computed-import"]), ids)).toEqual([
    "floating-promises",
  ]);
  expect(missingCustomRules(sarifWith(["x.not-computed-import"]), ["computed-import"])).toEqual(["computed-import"]);
});

test("semgrep_declared_rule_ids_read", () => {
  expect(declaredRuleIds("rules:\n  - id: computed-import\n    x: 1\n  - id: other\n")).toEqual([
    "computed-import",
    "other",
  ]);
});
