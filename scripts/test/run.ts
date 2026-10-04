// Test command: runs Vitest and fails unless every test file in the repository
// was selected by the include, ran at least one passing or failing test, and
// skipped nothing. In the prototype 20 of 47 UI test files silently never ran
// (PLAN.md §2 rule 27; engineering rule TE-4).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceFiles } from "../guards/files.ts";

const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts)$/;
const STRAY_SPEC = /\.spec\.[cm]?[jt]sx?$/;
const STRAY_JS_TEST = /\.test\.(?:js|mjs|cjs|jsx)$/;
const E2E_DIR = "tests/e2e/";
const VITEST_BIN = join(import.meta.dirname, "..", "..", "node_modules", "vitest", "vitest.mjs");
const LIST_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 15 * 60_000;

/** Arguments for "which files does the include select", without collecting tests. */
export const LIST_ARGS = ["list", "--filesOnly", "--json"] as const;

type Status = "passed" | "failed" | "skipped" | "pending" | "todo" | "disabled";
export type VitestJsonReport = {
  testResults: { name: string; assertionResults: { fullName: string; status: Status }[] }[];
};
export type Outcome = {
  notListed: string[];
  notExecuted: string[];
  allSkipped: string[];
  skippedCases: string[];
  stray: string[];
};
export type RunOptions = { root: string; config: string };

const toPosix = (root: string, file: string): string =>
  (isAbsolute(file) ? relative(root, file) : file).split(sep).join("/");
const isSkip = (status: Status): boolean => status !== "passed" && status !== "failed";
const ran = (results: { status: Status }[]): boolean => results.some((r) => !isSkip(r.status));

/** Every test file in the whole repository outside SKIP_DIRS, repo-relative and sorted. */
export function discoverByGlob(root: string): string[] {
  return sourceFiles(root, ["."]).filter((f) => TEST_FILE.test(f));
}

/** Files that look like tests but that no include selects. */
export function strayTestFiles(root: string): string[] {
  return sourceFiles(root, ["."]).filter(
    (f) => (STRAY_SPEC.test(f) && !f.startsWith(E2E_DIR)) || STRAY_JS_TEST.test(f),
  );
}

/** Files with at least one passing or failing test. */
export function executedFiles(root: string, report: VitestJsonReport): Set<string> {
  const files = report.testResults.filter((f) => ran(f.assertionResults));
  return new Set(files.map((f) => toPosix(root, f.name)));
}

/** Files whose every test was skipped, pending, todo or disabled. */
export function skippedOnly(root: string, report: VitestJsonReport): Set<string> {
  const files = report.testResults.filter((f) => !ran(f.assertionResults) && f.assertionResults.length > 0);
  return new Set(files.map((f) => toPosix(root, f.name)));
}

/** `<file> > <test>` for each skipped case hidden in a file that otherwise ran. */
export function skippedCases(root: string, report: VitestJsonReport): string[] {
  return report.testResults
    .filter((f) => ran(f.assertionResults))
    .flatMap((f) =>
      f.assertionResults.filter((r) => isSkip(r.status)).map((r) => `${toPosix(root, f.name)} > ${r.fullName}`),
    )
    .sort();
}

export function compare(
  glob: string[],
  listed: string[],
  executed: Set<string>,
  skipped: Set<string>,
  cases: string[],
  stray: string[],
): Outcome {
  const listedSet = new Set(listed);
  return {
    notListed: glob.filter((f) => !listedSet.has(f)).sort(),
    notExecuted: listed.filter((f) => !executed.has(f) && !skipped.has(f)).sort(),
    allSkipped: [...skipped].sort(),
    skippedCases: [...cases].sort(),
    stray: [...stray].sort(),
  };
}

function vitest(args: readonly string[], options: RunOptions, timeout: number) {
  return spawnSync(process.execPath, [VITEST_BIN, ...args, "--root", options.root, "--config", options.config], {
    cwd: options.root,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Files the include selects, from `vitest list --filesOnly --json`; null when the listing failed. */
export function listByVitest(options: RunOptions): string[] | null {
  const run = vitest(LIST_ARGS, options, LIST_TIMEOUT_MS);
  if (run.error || run.status !== 0) {
    console.error(run.stderr || run.error?.message);
    return null;
  }
  try {
    const entries = JSON.parse(run.stdout) as { file: string }[];
    return [...new Set(entries.map((e) => toPosix(options.root, e.file)))].sort();
  } catch {
    console.error("vitest list printed something other than JSON.");
    return null;
  }
}

function runVitest(options: RunOptions, outputFile: string): { status: number; report: VitestJsonReport } | null {
  const args = ["run", "--reporter=default", "--reporter=json", `--outputFile=${outputFile}`];
  const run = vitest(args, options, RUN_TIMEOUT_MS);
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  if (run.error) return null;
  try {
    return { status: run.status ?? 1, report: JSON.parse(readFileSync(outputFile, "utf8")) as VitestJsonReport };
  } catch {
    console.error("Vitest wrote no readable JSON report.");
    return null;
  }
}

function printOutcome(outcome: Outcome): boolean {
  let clean = true;
  for (const [heading, items] of Object.entries(outcome)) {
    if (items.length === 0) continue;
    clean = false;
    console.error(`\n${heading}:`);
    for (const item of items) console.error(`  ${item}`);
  }
  return clean;
}

export function main(options: RunOptions): number {
  const { root } = options;
  const glob = discoverByGlob(root);
  if (glob.length === 0) {
    console.error("No test files discovered.");
    return 1;
  }
  const listed = listByVitest(options);
  if (listed === null) return 1;
  const scratch = mkdtempSync(join(tmpdir(), "unset-test-"));
  try {
    const result = runVitest(options, join(scratch, "vitest.json"));
    if (result === null) return 1;
    const { report } = result;
    const outcome = compare(
      glob,
      listed,
      executedFiles(root, report),
      skippedOnly(root, report),
      skippedCases(root, report),
      strayTestFiles(root),
    );
    if (!printOutcome(outcome)) return 1;
    console.error(`\nAll ${glob.length} discovered test files ran.`);
    return result.status;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  process.exit(main({ root, config: join(root, "vitest.config.ts") }));
}
