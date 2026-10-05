// Proves the custom Semgrep rules in .semgrep/rules/ match what they claim (P1.01s; ruling
// 2026-10-05: this runs in the CI `semgrep` job, not in Vitest). Fixtures live at
// .semgrep/rules/fixtures/<rule-id>/<set>/<path>.ts, where <set> ends in _fails (each file must yield a
// finding from <rule-id>) or _passes (each file must yield no finding at all).
//
// The rules' own `paths.exclude` skips the fixtures folder so the repository scan never reports them,
// and .semgrepignore skips it for the registry packs. So `run` copies the rules with every `paths`
// block stripped, and the fixtures, into a temporary directory outside the repository, and scans
// that copy: no exclusion or ignore file can hide a fixture, whatever Semgrep's targeting rules are.
//
//   node scripts/lint/semgrep-fixtures.ts run           scan with SEMGREP_IMAGE (default: ci.yml's) and check
//   node scripts/lint/semgrep-fixtures.ts check <json>  check an existing `semgrep scan --json` report
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type Fixture = { file: string; rule: string; set: string; expect: "fail" | "pass" };
type Report = { results: { check_id: string; path: string }[]; errors: unknown[]; paths: { scanned: string[] } };

const ROOT = join(import.meta.dirname, "..", "..");
const RULES_DIR = join(ROOT, ".semgrep", "rules");
const FIXTURES = "fixtures";

/** `<rule>/<set>/<path>` relative to the fixtures folder; null unless the set ends in _fails or _passes. */
export function parseFixture(file: string): Fixture | null {
  const [rule, set, ...rest] = file.split("/");
  const kind = set?.match(/_(fails|passes)$/)?.[1];
  if (!rule || !set || !kind || rest.length === 0) return null;
  return { file, rule, set, expect: kind === "fails" ? "fail" : "pass" };
}

/** Every fixture file under `dir`; a file in a malformed folder throws, so a typo cannot hide one. */
export function fixturesUnder(dir: string): Fixture[] {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  return files.map((e) => {
    const file = relative(dir, join(e.parentPath, e.name)).split(sep).join("/");
    const fixture = parseFixture(file);
    if (!fixture) throw new Error(`fixture outside <rule>/<set>_fails|_passes/: ${file}`);
    return fixture;
  });
}

/** Semgrep prefixes a rule id with its config path (`.semgrep.rules.computed-import`). */
export const ruleIdOf = (checkId: string): string => checkId.slice(checkId.lastIndexOf(".") + 1);

export const declaredRuleIds = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s+- id:\s*(\S+)\s*$/gm)].map((m) => m[1] ?? "");

/** The rule YAML without its `paths:` blocks (a block ends at the next line indented no deeper). */
export function stripPaths(yaml: string): string {
  let inside: number | null = null;
  const kept = yaml.split("\n").filter((line) => {
    const indent = line.length - line.trimStart().length;
    if (inside !== null && (line.trim() === "" || indent > inside)) return false;
    inside = /^\s*paths:\s*$/.test(line) ? indent : null;
    return inside === null;
  });
  return kept.join("\n");
}

export const imageFromWorkflow = (ci: string): string | null =>
  ci.match(/^\s+SEMGREP_IMAGE:\s*(\S+)\s*$/m)?.[1] ?? null;

function parseReport(text: string): Report | null {
  try {
    const report = JSON.parse(text);
    const ok = Array.isArray(report?.results) && Array.isArray(report?.errors) && Array.isArray(report?.paths?.scanned);
    return ok ? report : null;
  } catch {
    return null;
  }
}

/** A scanned or reported path, made relative to the fixtures folder whatever the scan root was. */
const fixturePath = (path: string): string => path.slice(path.lastIndexOf(`${FIXTURES}/`) + FIXTURES.length + 1);

function coverage(fixtures: Fixture[], declared: string[]): string[] {
  const problems = fixtures.length === 0 ? ["zero fixtures: the scan proved nothing"] : [];
  for (const id of declared)
    for (const kind of ["fail", "pass"] as const)
      if (!fixtures.some((f) => f.rule === id && f.expect === kind)) problems.push(`${id} has no must-${kind} fixture`);
  return problems;
}

function fixtureProblems(fixtures: Fixture[], report: Report): string[] {
  const scanned = new Set(report.paths.scanned.map(fixturePath));
  const problems: string[] = [];
  for (const f of fixtures) {
    const rules = report.results.filter((r) => fixturePath(r.path) === f.file).map((r) => ruleIdOf(r.check_id));
    if (!scanned.has(f.file)) problems.push(`${f.set}: ${f.file} was not scanned`);
    else if (f.expect === "fail" && !rules.includes(f.rule))
      problems.push(`${f.set}: ${f.file} has no ${f.rule} finding`);
    else if (f.expect === "pass" && rules.length > 0) problems.push(`${f.set}: ${f.file} has findings: ${rules}`);
  }
  return problems;
}

function firedProblems(report: Report, declared: string[]): string[] {
  const fired = new Set(report.results.map((r) => ruleIdOf(r.check_id)));
  const never = declared.filter((id) => !fired.has(id));
  const undeclared = [...fired].filter((id) => !declared.includes(id));
  return [
    ...(never.length > 0 ? [`declared rule never fired: ${never.join(", ")}`] : []),
    ...(undeclared.length > 0 ? [`undeclared rule fired: ${undeclared.join(", ")}`] : []),
  ];
}

/** Every reason the report fails to prove the rules; empty means proven. Fails closed throughout. */
export function evaluate(reportText: string | null, fixtures: Fixture[], declared: string[]): string[] {
  if (reportText === null) return ["no Semgrep JSON report (image or Docker missing?)"];
  const report = parseReport(reportText);
  if (!report) return ["the report is not Semgrep JSON (results, errors, paths.scanned)"];
  const errors =
    report.errors.length > 0 ? [`${report.errors.length} Semgrep error(s): ${JSON.stringify(report.errors)}`] : [];
  return [
    ...errors,
    ...coverage(fixtures, declared),
    ...fixtureProblems(fixtures, report),
    ...firedProblems(report, declared),
  ];
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const ruleFiles = (): string[] => readdirSync(RULES_DIR).filter((f) => f.endsWith(".yml"));

function check(reportText: string | null): number {
  const fixtures = fixturesUnder(join(RULES_DIR, FIXTURES));
  const declared = ruleFiles().flatMap((f) => declaredRuleIds(readFileSync(join(RULES_DIR, f), "utf8")));
  const problems = evaluate(reportText, fixtures, declared);
  for (const problem of problems) console.error(`semgrep fixtures: ${problem}`);
  for (const set of new Set(fixtures.map((f) => f.set)))
    console.log(`${set}: ${fixtures.filter((f) => f.set === set).length} fixture(s)`);
  if (problems.length === 0)
    console.log(`semgrep fixtures: ${declared.length} rules proven on ${fixtures.length} files`);
  return problems.length === 0 ? 0 : 1;
}

/** Copies stripped rules and fixtures to a temporary directory, scans it with the pinned image, checks. */
function run(): number {
  const image =
    process.env.SEMGREP_IMAGE || imageFromWorkflow(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"));
  if (!image) return check(null);
  const work = mkdtempSync(join(tmpdir(), "semgrep-fixtures-"));
  try {
    mkdirSync(join(work, "rules"));
    for (const f of ruleFiles())
      writeFileSync(join(work, "rules", f), stripPaths(readFileSync(join(RULES_DIR, f), "utf8")));
    cpSync(join(RULES_DIR, FIXTURES), join(work, FIXTURES), { recursive: true });
    writeFileSync(join(work, ".semgrepignore"), "# Nothing ignored: every fixture is scanned.\n");
    const args = ["run", "--rm", "-v", `${work}:/work`, "-w", "/work", image, "semgrep", "scan"];
    args.push("--config", "rules/", "--metrics=off", "--json", "--output=/work/report.json", `${FIXTURES}/`);
    const scan = spawnSync("docker", args, { stdio: "inherit" });
    if (scan.status !== 0) console.error(`semgrep fixtures: docker exited ${scan.status ?? scan.error}`);
    return scan.status === 0 ? check(readOrNull(join(work, "report.json"))) : 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [mode, file] = process.argv.slice(2);
  if (mode === "run") process.exitCode = run();
  else if (mode === "check" && file) process.exitCode = check(readOrNull(file));
  else {
    console.error("usage: semgrep-fixtures.ts run | check <report.json>");
    process.exitCode = 2;
  }
}
