// Fails when a discovered Playwright spec did not run, or a test was skipped without an
// unexpired allowance (P1.26). Playwright's JSON reports are the input: one per e2e job (P0.07b).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export type SkipAllowance = { readonly title: string; readonly reason: string; readonly expires: string };

/** Empty. A skip needs a reason and a date, and an expired entry fails the run on its own. */
export const SKIP_ALLOWANCE: readonly SkipAllowance[] = [];

type TestResult = { readonly status?: string };
type ReportTest = { readonly status: string; readonly projectName?: string; readonly results: readonly TestResult[] };
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

/** The Playwright projects e2e.yml runs, one browser job each (tests/e2e/playwright.config.ts `projects`). */
export const E2E_PROJECTS = ["chromium", "firefox", "webkit"] as const;

/** One browser job's report: the project it ran (`--project`) and the file it came from. */
export type ProjectReport = { readonly project: string; readonly name: string; readonly report: PlaywrightReport };

function specsOf(report: PlaywrightReport): ReportSpec[] {
  const specs = [] as ReportSpec[];
  collect(report.suites, specs);
  return specs;
}

function coverage(reports: readonly ProjectReport[], projects: readonly string[]): string[] {
  const missing = projects.flatMap((project) => {
    const count = reports.filter((entry) => entry.project === project).length;
    if (count === 0) return [`no report for project: ${project}`];
    return count > 1 ? [`more than one report for project: ${project}`] : [];
  });
  const unexpected = reports.flatMap(({ project }) =>
    projects.includes(project) ? [] : [`unexpected project: ${project}`],
  );
  return [...missing, ...unexpected];
}

function reportProblems({ project, name, report }: ProjectReport): string[] {
  const specs = specsOf(report);
  if (specs.length === 0) return [`report ran no tests: ${name}`];
  const others = new Set(
    specs.flatMap((spec) => spec.tests.map((test) => test.projectName ?? "")).filter((other) => other !== project),
  );
  return [...others].map((other) => `${name} holds tests of project "${other}", not ${project}`);
}

/**
 * Problems across the browser jobs' reports (P0.07b). Each expected project has exactly one report, each report
 * holds tests of its own project only and at least one spec, and a discovered spec counts as run when any report
 * has it. So a missing, duplicated or empty leg fails, and none can hide behind the others.
 */
export function problemsAcross(
  reports: readonly ProjectReport[],
  projects: readonly string[],
  discovered: readonly string[],
  allowance: readonly SkipAllowance[],
  today: string,
): string[] {
  const merged: PlaywrightReport = { suites: reports.flatMap(({ report }) => report.suites ?? []) };
  return [
    ...coverage(reports, projects),
    ...reports.flatMap(reportProblems),
    ...problems(merged, discovered, allowance, today),
  ];
}

/** `<project>=<report path>`, one per browser job. */
export function parseReportArg(arg: string): { readonly project: string; readonly path: string } {
  const at = arg.indexOf("=");
  if (at <= 0 || at === arg.length - 1) throw new Error(`expected <project>=<report path>, got: ${arg}`);
  return { project: arg.slice(0, at), path: arg.slice(at + 1) };
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
  const reports = process.argv.slice(2).map((arg) => {
    const { project, path } = parseReportArg(arg);
    return { project, name: path, report: JSON.parse(readFileSync(path, "utf8")) as PlaywrightReport };
  });
  const found = problemsAcross(
    reports,
    E2E_PROJECTS,
    discoverSpecs(join(root, "tests/e2e")),
    SKIP_ALLOWANCE,
    todayUtc(),
  );
  if (found.length > 0) {
    console.error(found.join("\n"));
    process.exit(1);
  }
}
