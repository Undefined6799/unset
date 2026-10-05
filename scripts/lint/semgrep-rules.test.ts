// The static half of P1.01s: the rule files and CI wiring, read without running Semgrep. Whether the
// patterns match is proven by the CI fixture step (scripts/lint/semgrep-fixtures.ts; ruling 2026-10-05).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { declaredRuleIds, fixturesUnder } from "./semgrep-fixtures.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_DIR = join(ROOT, ".semgrep", "rules");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const ruleFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith(".yml"));
const text = (file: string): string => readFileSync(join(RULES_DIR, file), "utf8");
const EXCLUDES = ["scripts/", "tests/", "**/*.test.ts", ".semgrep/rules/fixtures/"];

/** The text of each `- id:` entry in a rule file, keyed by id. */
function rulesIn(yaml: string): Map<string, string> {
  const parts = yaml.split(/^(?=\s+- id:)/m).slice(1);
  return new Map(parts.map((part) => [declaredRuleIds(part)[0] ?? "", part]));
}

test("rule_files_exist", () => {
  expect(ruleFiles.sort()).toEqual(expect.arrayContaining(["computed-import.yml", "floating-promises.yml"]));
});

describe.each(ruleFiles)("%s", (file) => {
  const rules = rulesIn(text(file));

  test("declares_rules_under_a_rules_key", () => {
    expect(text(file)).toMatch(/^rules:\s*$/m);
    expect(rules.size).toBeGreaterThan(0);
  });

  test.each([...rules])("%s: typescript, ERROR, required excludes", (_id, body) => {
    expect(body).toMatch(/^\s+languages: \[typescript\]\s*$/m);
    expect(body).toMatch(/^\s+severity: ERROR\s*$/m);
    const exclude = body.match(/^\s+paths:\s*\n\s+exclude:\s*\n((?:\s+- .*\n)+)/m)?.[1] ?? "";
    const listed = [...exclude.matchAll(/- "?([^"\n]+)"?/g)].map((m) => m[1]);
    expect(listed).toEqual(expect.arrayContaining(EXCLUDES));
  });
});

test("every_rule_has_a_must_fail_and_a_must_pass_fixture", () => {
  const fixtures = fixturesUnder(join(RULES_DIR, "fixtures"));
  for (const id of ruleFiles.flatMap((f) => declaredRuleIds(text(f)))) {
    const kinds = new Set(fixtures.filter((f) => f.rule === id).map((f) => f.expect));
    expect([...kinds].sort(), id).toEqual(["fail", "pass"]);
  }
});

test("spec_fixture_sets_exist", () => {
  const sets = new Set(fixturesUnder(join(RULES_DIR, "fixtures")).map((f) => f.set));
  for (const name of [
    "computed_import_fails",
    "literal_import_passes",
    "floating_promise_fails",
    "handled_promise_passes",
  ])
    expect(sets, name).toContain(name);
});

test("computed_import_fixtures_cover_apps_and_domains", () => {
  const files = fixturesUnder(join(RULES_DIR, "fixtures")).filter((f) => f.set === "computed_import_fails");
  expect(files.some((f) => f.file.includes("/apps/web/"))).toBe(true);
  expect(files.some((f) => f.file.includes("/domains/identity/"))).toBe(true);
});

test("floating_promises_message_says_not_type_aware", () => {
  const message = text("floating-promises.yml").match(/message: >-\n((?:\s{6}.*\n)+)/)?.[1] ?? "";
  expect(message.replace(/\s+/g, " ")).toMatch(/not type-aware/);
});

test("rules_folder_loaded", () => {
  expect(CI).toMatch(/semgrep scan [^\n]*--config \.semgrep\/rules\//);
});

test("ci_runs_the_fixture_check", () => {
  expect(CI).toMatch(/^\s+run: node scripts\/lint\/semgrep-fixtures\.ts run\s*$/m);
});
