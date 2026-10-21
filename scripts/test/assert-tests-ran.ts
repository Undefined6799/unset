// Fails when a discovered Playwright spec did not run, or a test was skipped without an
// unexpired allowance (P1.26). Playwright's JSON report is the input.
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type SkipAllowance = { readonly title: string; readonly reason: string; readonly expires: string };

/** Empty. A skip needs a reason and a date, and an expired entry fails the run on its own. */
export const SKIP_ALLOWANCE: readonly SkipAllowance[] = [];

type TestResult = { readonly status?: string };
type ReportTest = { readonly status: string; readonly results: readonly TestResult[] };
type ReportSpec = { readonly title: string; readonly file: string; readonly tests: readonly ReportTest[] };
type ReportSuite = { readonly specs?: readonly ReportSpec[]; readonly suites?: readonly ReportSuite[] };
export type PlaywrightReport = {
  readonly config?: { readonly rootDir: string };
  readonly suites?: readonly ReportSuite[];
};

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

// Playwright 1.64.0 JSON reporter (lib/runner/index.js:4306–4312) serializes files relative to config.rootDir; absolute paths
// are normalized against that same explicit root. Never accept arbitrary matching suffixes.
function uncoveredSpecs(specs: readonly ReportSpec[], discovered: readonly string[], root: string): string[] {
  const normalized = (file: string) =>
    relative(root, isAbsolute(file) ? file : resolve(root, file))
      .split(sep)
      .join("/");
  const ran = new Set(
    specs.filter((spec) => spec.tests.some((test) => test.results.length > 0)).map((spec) => normalized(spec.file)),
  );
  return discovered.flatMap((file) => (ran.has(normalized(file)) ? [] : [`discovered test file did not run: ${file}`]));
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

/** Discovered/report-relative paths use the test root (Playwright config.rootDir), never the report file directory. */
export function problems(
  report: PlaywrightReport,
  discovered: readonly string[],
  allowance: readonly SkipAllowance[],
  today: string,
  testRoot: string = process.cwd(),
): string[] {
  const specs = [] as ReportSpec[];
  collect(report.suites, specs);
  return [
    ...expiredSkips(allowance, today),
    ...(report.config && resolve(report.config.rootDir) !== resolve(testRoot)
      ? ["report config root differs from expected test root"]
      : []),
    ...uncoveredSpecs(specs, discovered, resolve(testRoot)),
    ...skippedWithoutAllowance(specs, allowance, today),
  ];
}

export function discoverSpecs(dir: string): string[] {
  const walk = (folder: string): string[] =>
    readdirSync(join(dir, folder), { withFileTypes: true }).flatMap((entry) => {
      const file = join(folder, entry.name);
      return entry.isDirectory()
        ? walk(file)
        : entry.isFile() && file.endsWith(".spec.ts")
          ? [file.split(sep).join("/")]
          : [];
    });
  return walk("").sort();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  const root = join(import.meta.dirname, "../..");
  const reportPath = process.argv[2] ?? join(root, "tests/e2e/report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as PlaywrightReport;
  const found = problems(
    report,
    discoverSpecs(join(root, "tests/e2e")),
    SKIP_ALLOWANCE,
    todayUtc(),
    join(root, "tests/e2e"),
  );
  if (found.length > 0) {
    console.error(found.join("\n"));
    process.exit(1);
  }
}
