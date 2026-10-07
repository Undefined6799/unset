import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { check, countLines, main } from "./check.ts";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "budgets-"));
  temps.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n");

test("count_skips_comments_and_blanks", () => {
  const source = [
    "// one",
    "const a = 1;",
    "",
    "/* two",
    "   still two */",
    "const b = 2;",
    "",
    "const c = 3; // tail",
  ];
  expect(countLines(source.join("\n"))).toBe(3);
});

test("count_ends_block_comment_before_code", () => {
  expect(countLines("/* a */ const a = 1;\n/** doc */\n/*\n*/ const b = 2;\n/* a */ /* b */ const c = 3;")).toBe(3);
});

test("count_excludes_tests_and_generated", () => {
  const root = tree({ "interfaces/media/a.test.ts": lines(50), "interfaces/media/x.generated.ts": lines(50) });
  expect(check(root, { "interfaces/media": 10 })).toEqual([]);
});

test("budgets_skip_fakes", () => {
  // A fake is a test double, not module code (architecture ruling 2026-10-04 23:53Z).
  const root = tree({ "infrastructure/net-guard/x.ts": lines(50), "infrastructure/net-guard/x.fake.ts": lines(500) });
  expect(check(root, { "infrastructure/net-guard": 100 })).toEqual([]);
});

test("budget_overrun_warns_not_fails", () => {
  const root = tree({
    "interfaces/media/a.ts": lines(12),
    "scripts/budgets/budgets.json": JSON.stringify({ "interfaces/media": 10 }),
  });
  const out: string[] = [];
  const summary = join(root, "summary.md");
  expect(main(root, (line) => out.push(line), summary)).toBe(0);
  expect(out).toEqual(["::warning title=line-budget::interfaces/media 12/10"]);
  expect(readFileSync(summary, "utf8")).toContain("| interfaces/media | 12 | 10 | warning |");
});

test("budget_reason_field", () => {
  // Alex via architecture, 2026-10-05: a raised budget is allowed when it records why; budgets warn, never gate.
  const run = (budgets: object) => {
    const root = tree({
      "infrastructure/net-guard/a.ts": lines(460),
      "scripts/budgets/budgets.json": JSON.stringify(budgets),
    });
    const out: string[] = [];
    expect(main(root, (line) => out.push(line))).toBe(0);
    return out;
  };
  const reason = "the proxy reads best as one module (review 2026-10-05)";
  expect(run({ "infrastructure/net-guard": { max: 500, reason } })).toEqual([
    `::notice title=line-budget::infrastructure/net-guard 460/500 (raised: ${reason})`,
  ]);
  expect(run({ "infrastructure/net-guard": 500 })).toEqual([
    "::warning title=line-budget::infrastructure/net-guard raised to 500 above the plan's 400 without a reason",
    "::notice title=line-budget::infrastructure/net-guard 460/500",
  ]);
  expect(run({ "infrastructure/net-guard": { max: 500, reason: " " } })[0]).toMatch(/without a reason$/);
  expect(run({ "infrastructure/net-guard": { max: "500" } })[0]).toMatch(/^::warning title=line-budget::budget check/);
});

test("budget_near_limit_is_a_notice", () => {
  const root = tree({ "interfaces/media/a.ts": lines(10) });
  expect(check(root, { "interfaces/media": 11 })).toEqual([
    { key: "interfaces/media", lines: 10, max: 11, level: "notice" },
  ]);
});

test("budget_file_unreadable_warns_not_fails", () => {
  const root = tree({ "scripts/budgets/budgets.json": "{ not json" });
  const out: string[] = [];
  expect(main(root, (line) => out.push(line))).toBe(0);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/^::warning title=line-budget::budget check could not run: /);
});

test("combined_admin_budget", () => {
  const key = "apps/admin + interfaces/admin + interfaces/pds-admin + infrastructure/audit";
  const root = tree({
    "apps/admin/a.tsx": lines(800),
    "interfaces/admin/a.ts": lines(800),
    "interfaces/pds-admin/a.ts": lines(800),
    "infrastructure/audit/a.ts": lines(800),
    "infrastructure/pds/a.ts": lines(800),
  });
  const budgets = JSON.parse(readFileSync(join(import.meta.dirname, "budgets.json"), "utf8"));
  expect(budgets[key]).toBe(3000);
  expect(check(root, { [key]: 3000 })).toEqual([{ key, lines: 3200, max: 3000, level: "warning" }]);
});

test("core_budget_subtracts_net_guard_and_audit", () => {
  const root = tree({
    "domains/identity/a.ts": lines(5),
    "infrastructure/pds/a.ts": lines(5),
    "infrastructure/net-guard/a.ts": lines(100),
    "infrastructure/audit/a.ts": lines(100),
    "shared/http/a.ts": lines(5),
    "shared/ui/a.ts": lines(100),
  });
  const key = "domains + infrastructure + !infrastructure/net-guard + !infrastructure/audit + shared/http";
  expect(check(root, { [key]: 14 })).toEqual([{ key, lines: 15, max: 14, level: "warning" }]);
});

test("budgets_match_plan", () => {
  // Plan section 4 mapped onto the decision-34 folders; a change here shows in review.
  const budgets = JSON.parse(readFileSync(join(import.meta.dirname, "budgets.json"), "utf8"));
  expect(budgets).toEqual({
    "domains + infrastructure + !infrastructure/net-guard + !infrastructure/audit + shared/config + shared/errors + shared/i18n + shared/log + shared/http + shared/admin-envelope": 9000,
    "apps/web + interfaces/http": 7000,
    "interfaces/api": 1200,
    "interfaces/indexer": 1500,
    "interfaces/media": 600,
    "interfaces/review": 2500,
    "apps/admin + interfaces/admin + interfaces/pds-admin + infrastructure/audit": 3000,
    "infrastructure/net-guard": 400,
    "shared/ui": 2500,
    "shared/ui-build": 800,
  });
});

test("ui_build_counted_under_its_own_key", () => {
  // P1.25w (architecture ruling 2026-10-07-p125h-follow-ups, N1): the moved runners are measured on their own, never
  // under shared/ui, and the plan defaults carry the same number as budgets.json.
  const root = tree({ "shared/ui/a.ts": lines(10), "shared/ui-build/a.ts": lines(900) });
  expect(check(root, { "shared/ui": 2500, "shared/ui-build": 800 })).toEqual([
    { key: "shared/ui-build", lines: 900, max: 800, level: "warning" },
  ]);
  expect(check(root, { "shared/ui": 9 })).toEqual([{ key: "shared/ui", lines: 10, max: 9, level: "warning" }]);
  const out: string[] = [];
  const budgets = JSON.parse(readFileSync(join(import.meta.dirname, "budgets.json"), "utf8"));
  const real = tree({ "shared/ui-build/a.ts": lines(900), "scripts/budgets/budgets.json": JSON.stringify(budgets) });
  expect(main(real, (line) => out.push(line), join(real, "summary.md"))).toBe(0);
  expect(out).toContain("::warning title=line-budget::shared/ui-build 900/800");
});

test("summary_unwritable_still_exits_zero", () => {
  const root = tree({
    "interfaces/media/a.ts": lines(12),
    "scripts/budgets/budgets.json": JSON.stringify({ "interfaces/media": 10 }),
  });
  const out: string[] = [];
  expect(main(root, (line) => out.push(line), join(root, "missing", "dir", "summary.md"))).toBe(0);
  expect(out[0]).toBe("::warning title=line-budget::interfaces/media 12/10");
  expect(out[1]).toMatch(/^::warning title=line-budget::step summary not written: /);
});

test("missing_folder_counts_zero", () => {
  expect(check(tree({}), { "interfaces/api": 1 })).toEqual([]);
});
