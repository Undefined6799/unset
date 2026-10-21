// Fails when a discovered Playwright spec did not run, or a test was skipped without an
// unexpired allowance (P1.26). Playwright's JSON reports are the input: one per e2e job (P0.07b).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export type SkipAllowance = { readonly title: string; readonly reason: string; readonly expires: string };

/** Empty. A skip needs a reason and a date, and an expired entry fails the run on its own. */
export const SKIP_ALLOWANCE: readonly SkipAllowance[] = [];

type TestResult = { readonly status?: string };
type ReportTest = { readonly status: string; readonly results: readonly TestResult[] };
type ReportSpec = { readonly title: string; readonly file: string; readonly tests: readonly ReportTest[] };
type ReportSuite = { readonly specs?: readonly ReportSpec[]; readonly suites?: readonly ReportSuite[] };
export type PlaywrightReport = { readonly suites?: readonly ReportSuite[] };

const DATED = /^\d{4}-\d{2}-\d{2}$/;

function collect(suites: readonly ReportSuite[] | undefined, out: ReportSpec[]): void {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) out.push(spec);
    collect(suite.suites, out);
  }
}

function skipped(test: ReportTest): boolean {
  if (test.status === "skipped") return true;
  return test.results.length > 0 && test.results.every((result) => result.status === "skipped");
}

function expiredSkips(allowance: readonly SkipAllowance[], today: string): string[] {
  return allowance.flatMap((entry) =>
    !DATED.test(entry.expires) || entry.expires < today
      ? [`skip allowance expired: ${entry.title} (${entry.expires})`]
      : [],
  );
}

function uncoveredSpecs(specs: readonly ReportSpec[], discovered: readonly string[]): string[] {
  const ran = new Set(specs.map((spec) => basename(spec.file)));
  return discovered.flatMap((file) => (ran.has(basename(file)) ? [] : [`discovered test file did not run: ${file}`]));
}

function skippedWithoutAllowance(
  specs: readonly ReportSpec[],
  allowance: readonly SkipAllowance[],
  today: string,
): string[] {
  const active = allowance.filter((entry) => DATED.test(entry.expires) && entry.expires >= today);
  return specs.flatMap((spec) =>
    spec.tests.some((test) => skipped(test)) && !active.some((entry) => entry.title === spec.title)
      ? [`skipped without an allowance: ${spec.title}`]
      : [],
  );
}

/** Problems in one report. `discovered` is the spec files on disk, repo-relative or bare. */
export function problems(
  report: PlaywrightReport,
  discovered: readonly string[],
  allowance: readonly SkipAllowance[],
  today: string,
): string[] {
  const specs = [] as ReportSpec[];
  collect(report.suites, specs);
  return [
    ...expiredSkips(allowance, today),
    ...uncoveredSpecs(specs, discovered),
    ...skippedWithoutAllowance(specs, allowance, today),
  ];
}

export type NamedReport = { readonly name: string; readonly report: PlaywrightReport };

/**
 * Problems across the reports of jobs that each ran part of the suite (one browser project per job). A discovered
 * spec counts as run when any report has it, and every report must hold at least one spec, so a job that ran
 * nothing cannot hide behind the others.
 */
export function problemsAcross(
  reports: readonly NamedReport[],
  discovered: readonly string[],
  allowance: readonly SkipAllowance[],
  today: string,
): string[] {
  const empty = reports.flatMap(({ name, report }) => {
    const specs = [] as ReportSpec[];
    collect(report.suites, specs);
    return specs.length === 0 ? [`report ran no tests: ${name}`] : [];
  });
  const merged: PlaywrightReport = { suites: reports.flatMap(({ report }) => report.suites ?? []) };
  return [
    ...(reports.length === 0 ? ["no reports given"] : []),
    ...empty,
    ...problems(merged, discovered, allowance, today),
  ];
}

export function discoverSpecs(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  const root = join(import.meta.dirname, "../..");
  const given = process.argv.slice(2);
  const paths = given.length > 0 ? given : [join(root, "tests/e2e/report.json")];
  const reports = paths.map((name) => ({ name, report: JSON.parse(readFileSync(name, "utf8")) as PlaywrightReport }));
  const found = problemsAcross(reports, discoverSpecs(join(root, "tests/e2e")), SKIP_ALLOWANCE, todayUtc());
  if (found.length > 0) {
    console.error(found.join("\n"));
    process.exit(1);
  }
}
