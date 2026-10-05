// The decision logic of the Semgrep fixture check, on hand-written `semgrep scan --json` reports
// (shape: results[].check_id and results[].path, errors[], paths.scanned[]; Semgrep CLI JSON output).
import { describe, expect, test } from "vitest";
import {
  declaredRuleIds,
  evaluate,
  type Fixture,
  imageFromWorkflow,
  parseFixture,
  ruleIdOf,
  stripPaths,
} from "./semgrep-fixtures.ts";

const FIXTURES: Fixture[] = [
  "computed-import/computed_import_fails/apps/web/import-name.ts",
  "computed-import/literal_import_passes/literal.ts",
  "floating-promises/floating_promise_fails/call.ts",
  "floating-promises/handled_promise_passes/await.ts",
].map((file) => parseFixture(file) as Fixture);
const DECLARED = ["computed-import", "floating-promises"];
const PREFIX = "fixtures/";

type Result = { check_id: string; path: string };
const finding = (rule: string, file: string): Result => ({ check_id: `rules.${rule}`, path: `${PREFIX}${file}` });
const GOOD: Result[] = [
  finding("computed-import", "computed-import/computed_import_fails/apps/web/import-name.ts"),
  finding("floating-promises", "floating-promises/floating_promise_fails/call.ts"),
];
const report = (results: Result[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ results, errors: [], paths: { scanned: FIXTURES.map((f) => `${PREFIX}${f.file}`) }, ...extra });

describe("parseFixture", () => {
  test("rule_set_and_expectation_come_from_the_path", () => {
    expect(parseFixture("computed-import/computed_import_fails/domains/identity/x.ts")).toEqual({
      file: "computed-import/computed_import_fails/domains/identity/x.ts",
      rule: "computed-import",
      set: "computed_import_fails",
      expect: "fail",
    });
    expect(parseFixture("floating-promises/handled_promise_passes/a.ts")?.expect).toBe("pass");
  });

  test("a_set_without_fails_or_passes_is_rejected", () => {
    expect(parseFixture("computed-import/maybe/a.ts")).toBeNull();
    expect(parseFixture("computed-import/a.ts")).toBeNull();
  });
});

test("rule_id_is_the_suffix_after_the_last_dot", () => {
  expect(ruleIdOf(".semgrep.rules.computed-import")).toBe("computed-import");
  expect(ruleIdOf("tmp.x.rules.floating-promises")).toBe("floating-promises");
  expect(ruleIdOf("computed-import")).toBe("computed-import");
});

describe("evaluate", () => {
  test("clean_run_has_no_problems", () => {
    expect(evaluate(report(GOOD), FIXTURES, DECLARED)).toEqual([]);
  });

  test("checked_relative_to_the_repo_prefix_too", () => {
    const results = GOOD.map((r) => ({ check_id: `.semgrep.${r.check_id}`, path: `.semgrep/rules/${r.path}` }));
    const scanned = FIXTURES.map((f) => `.semgrep/rules/fixtures/${f.file}`);
    expect(evaluate(JSON.stringify({ results, errors: [], paths: { scanned } }), FIXTURES, DECLARED)).toEqual([]);
  });

  test("missing_or_unparseable_report_fails", () => {
    expect(evaluate(null, FIXTURES, DECLARED)).toEqual([expect.stringMatching(/no Semgrep JSON/)]);
    expect(evaluate("not json", FIXTURES, DECLARED)).toEqual([expect.stringMatching(/not Semgrep JSON/)]);
    expect(evaluate("{}", FIXTURES, DECLARED)).toEqual([expect.stringMatching(/not Semgrep JSON/)]);
  });

  test("zero_fixtures_fails", () => {
    expect(evaluate(report(GOOD), [], DECLARED)).toContainEqual(expect.stringMatching(/zero fixtures/));
    const unscanned = JSON.stringify({ results: GOOD, errors: [], paths: { scanned: [] } });
    expect(evaluate(unscanned, FIXTURES, DECLARED)).toContainEqual(expect.stringMatching(/not scanned/));
  });

  test("semgrep_errors_fail", () => {
    const problems = evaluate(report(GOOD, { errors: [{ message: "bad rule" }] }), FIXTURES, DECLARED);
    expect(problems).toContainEqual(expect.stringMatching(/1 Semgrep error/));
  });

  test("must_fail_fixture_without_its_finding_fails", () => {
    const problems = evaluate(report([GOOD[1] as Result]), FIXTURES, DECLARED);
    expect(problems).toContainEqual(
      expect.stringMatching(/computed_import_fails.*import-name\.ts.*no computed-import/),
    );
  });

  test("finding_from_another_rule_does_not_count", () => {
    const wrong = finding("floating-promises", "computed-import/computed_import_fails/apps/web/import-name.ts");
    const problems = evaluate(report([wrong, GOOD[1] as Result]), FIXTURES, DECLARED);
    expect(problems).toContainEqual(expect.stringMatching(/no computed-import finding/));
  });

  test("must_pass_fixture_with_any_finding_fails", () => {
    const extra = finding("computed-import", "floating-promises/handled_promise_passes/await.ts");
    const problems = evaluate(report([...GOOD, extra]), FIXTURES, DECLARED);
    expect(problems).toContainEqual(expect.stringMatching(/handled_promise_passes.*await\.ts.*computed-import/));
  });

  test("fired_rules_must_equal_declared_rules", () => {
    const problems = evaluate(report(GOOD), FIXTURES, [...DECLARED, "transactions"]);
    expect(problems).toContainEqual(expect.stringMatching(/never fired: transactions/));
    const stray = finding("other", "computed-import/computed_import_fails/apps/web/import-name.ts");
    expect(evaluate(report([...GOOD, stray]), FIXTURES, DECLARED)).toContainEqual(
      expect.stringMatching(/undeclared rule fired: other/),
    );
  });

  test("every_declared_rule_needs_both_fixture_kinds", () => {
    const onlyFail = FIXTURES.filter((f) => f.set !== "handled_promise_passes");
    expect(evaluate(report(GOOD), onlyFail, DECLARED)).toContainEqual(
      expect.stringMatching(/floating-promises has no must-pass fixture/),
    );
  });
});

describe("rule files", () => {
  const RULE = [
    "rules:",
    "  - id: computed-import",
    "    languages: [typescript]",
    "    paths:",
    "      exclude:",
    '        - "scripts/"',
    '        - ".semgrep/rules/fixtures/"',
    "    severity: ERROR",
    "  - id: other",
    "    paths:",
    "      include: [x]",
    "    message: m",
    "",
  ].join("\n");

  test("declared_rule_ids_are_listed", () => {
    expect(declaredRuleIds(RULE)).toEqual(["computed-import", "other"]);
  });

  test("strip_paths_removes_every_paths_block_and_nothing_else", () => {
    expect(stripPaths(RULE)).toBe(
      [
        "rules:",
        "  - id: computed-import",
        "    languages: [typescript]",
        "    severity: ERROR",
        "  - id: other",
        "    message: m",
        "",
      ].join("\n"),
    );
  });
});

test("image_is_read_from_the_workflow", () => {
  const ci = "jobs:\n  semgrep:\n    env:\n      SEMGREP_IMAGE: semgrep/semgrep:1.0.0@sha256:abc\n";
  expect(imageFromWorkflow(ci)).toBe("semgrep/semgrep:1.0.0@sha256:abc");
  expect(imageFromWorkflow("jobs: {}\n")).toBeNull();
});
