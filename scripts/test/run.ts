// Test command: runs Vitest and fails unless every test file in the repository
// was selected by the include, ran at least one passing or failing test, and
// skipped nothing. In the prototype 20 of 47 UI test files silently never ran
// (PLAN.md §2 rule 27; engineering rule TE-4).
//
// Image tests (`*.image.test.ts`, the `images` project) are decided here once, by environment (P1.28r; step book
// 2026-10-07 p123d-p128i-p128r-test-timing, amendment 1): with CI=true they run after the unit projects; locally they
// are not started and one line says so; `npm run test:images` runs only them, under CI's rules.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceFiles } from "../guards/files.ts";

const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts)$/;
const IMAGE_TEST_FILE = /\.image\.test\.(?:ts|tsx|mts|cts)$/;
const IMAGES_PROJECT = "images";
const STRAY_SPEC = /\.spec\.[cm]?[jt]sx?$/;
const STRAY_JS_TEST = /\.test\.(?:js|mjs|cjs|jsx)$/;
const E2E_DIR = "tests/e2e/";
const VITEST_BIN = join(import.meta.dirname, "..", "..", "node_modules", "vitest", "vitest.mjs");
// Both stay inside the CI job's 15-minute budget, so a hang is reported here.
const LIST_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;

/** Arguments for "which files does the include select", without collecting tests. */
export const LIST_ARGS = ["list", "--filesOnly", "--json"] as const;

type Status = "passed" | "failed" | "skipped" | "pending" | "todo" | "disabled";
export type VitestJsonReport = {
  testResults: { name: string; status: string; assertionResults: { fullName: string; status: Status }[] }[];
};
export type Outcome = {
  notListed: string[];
  notExecuted: string[];
  allSkipped: string[];
  skippedCases: string[];
  stray: string[];
};
/** Which projects run: all of them (CI), all but images (local), or images only (`npm run test:images`). */
export type Mode = "ci" | "local" | "images";
/** `quiet` keeps Vitest's own output off the terminal, and `dockerReady` replaces the Docker probe (the end-to-end
 * tests of this file). */
export type RunOptions = {
  root: string;
  config: string;
  mode: Mode;
  quiet?: boolean;
  dockerReady?: () => boolean;
};
/** The Vitest runs for one mode, in order; the files they must run; the local not-run line; why the mode cannot run. */
export type ImagesPlan = { runs: string[][]; expected: string[]; notRun: string | null; problem: string | null };

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

/** Files whose every test was skipped, pending, todo or disabled. A file whose suite failed
 * (a throwing beforeAll marks every test skipped) did not run, so it is not counted here. */
export function skippedOnly(root: string, report: VitestJsonReport): Set<string> {
  const files = report.testResults.filter(
    (f) => f.status !== "failed" && !ran(f.assertionResults) && f.assertionResults.length > 0,
  );
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

/** `toRun` is the listed files this run starts; the rest are reported only if no include selects them. */
export function compare(
  glob: string[],
  listed: string[],
  executed: Set<string>,
  skipped: Set<string>,
  cases: string[],
  stray: string[],
  toRun: string[] = listed,
): Outcome {
  const listedSet = new Set(listed);
  return {
    notListed: glob.filter((f) => !listedSet.has(f)).sort(),
    notExecuted: toRun.filter((f) => !executed.has(f) && !skipped.has(f)).sort(),
    allSkipped: [...skipped].sort(),
    skippedCases: [...cases].sort(),
    stray: [...stray].sort(),
  };
}

/** The mode the command line and environment ask for; `--images` is the only argument. */
export function modeFor(env: Record<string, string | undefined>, args: readonly string[]): Mode {
  const unknown = args.find((arg) => arg !== "--images");
  if (unknown !== undefined) throw new Error(`unknown argument ${unknown}`);
  if (args.includes("--images")) return "images";
  return env.CI === "true" ? "ci" : "local";
}

/** What one mode runs. A mode that runs the images project needs at least one image test, so it can never pass
 * by collecting nothing. */
export function imagesPlan(mode: Mode, glob: string[]): ImagesPlan {
  const images = glob.filter((f) => IMAGE_TEST_FILE.test(f));
  const units = [`--project=!${IMAGES_PROJECT}`];
  const imageRun = [`--project=${IMAGES_PROJECT}`];
  if (mode === "local") {
    const count = `${images.length} file${images.length === 1 ? "" : "s"}`;
    const notRun = `images project: not run locally (${count}; CI runs them; npm run test:images to run)`;
    return {
      runs: [units],
      expected: glob.filter((f) => !IMAGE_TEST_FILE.test(f)),
      notRun: images.length === 0 ? null : notRun,
      problem: null,
    };
  }
  const problem = images.length === 0 ? "the images project has no *.image.test.ts file to run" : null;
  if (mode === "images") return { runs: [imageRun], expected: images, notRun: null, problem };
  return { runs: [units, imageRun], expected: glob, notRun: null, problem };
}

/** `docker info` succeeds: the daemon is reachable. */
function dockerReady(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore", timeout: LIST_TIMEOUT_MS }).status === 0;
}

/** The argument vector for one Vitest command, run with the current Node. */
export function vitestArgs(args: readonly string[], options: Pick<RunOptions, "root" | "config">): string[] {
  return [VITEST_BIN, ...args, "--root", options.root, "--config", options.config];
}

type ChildResult = { status: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Runs Vitest in its own process group, so a timeout also stops its workers. */
function vitest(
  args: readonly string[],
  options: RunOptions,
  timeout: number,
  output: "pipe" | "inherit",
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, vitestArgs(args, options), {
      cwd: options.root,
      detached: true,
      stdio: ["ignore", output, output],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`vitest ${args[0]} did not finish within ${timeout / 1000} s; stopping it.`);
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`vitest ${args[0]} could not start: ${error.message}`);
      resolve({ status: null, stdout, stderr, timedOut });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

/** Files the include selects, from `vitest list --filesOnly --json`; null when the listing failed. */
export async function listByVitest(options: RunOptions): Promise<string[] | null> {
  const run = await vitest(LIST_ARGS, options, LIST_TIMEOUT_MS, "pipe");
  if (run.timedOut) return null;
  if (run.status !== 0) {
    console.error(run.stderr);
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

async function runVitest(
  options: RunOptions,
  projects: readonly string[],
  outputFile: string,
): Promise<{ status: number; report: VitestJsonReport } | null> {
  const args = ["run", ...projects, "--reporter=default", "--reporter=json", `--outputFile=${outputFile}`];
  const run = await vitest(args, options, RUN_TIMEOUT_MS, options.quiet ? "pipe" : "inherit");
  if (run.timedOut) return null;
  try {
    return { status: run.status ?? 1, report: JSON.parse(readFileSync(outputFile, "utf8")) as VitestJsonReport };
  } catch {
    console.error("Vitest wrote no readable JSON report.");
    return null;
  }
}

const HEADINGS: Record<keyof Outcome, string> = {
  notListed: "Test files the Vitest include does not select",
  notExecuted: "Test files that ran no passing or failing test",
  allSkipped: "Test files whose every test is skipped",
  skippedCases: "Skipped tests in files that otherwise ran",
  stray: "Files that look like tests but match no include",
};

function printOutcome(outcome: Outcome): boolean {
  let clean = true;
  for (const key of Object.keys(HEADINGS) as (keyof Outcome)[]) {
    const items = outcome[key];
    if (items.length === 0) continue;
    clean = false;
    console.error(`\n${HEADINGS[key]} (${key}):`);
    for (const item of items) console.error(`  ${item}`);
  }
  return clean;
}

export async function main(given: RunOptions): Promise<number> {
  // Vitest reports real paths, so compare against the real root too.
  const options = { ...given, root: realpathSync(given.root) };
  const { root } = options;
  const glob = discoverByGlob(root);
  if (glob.length === 0) {
    console.error("No test files discovered.");
    return 1;
  }
  const plan = imagesPlan(options.mode, glob);
  if (plan.problem !== null) {
    console.error(plan.problem);
    return 1;
  }
  if (options.mode === "images" && !(options.dockerReady ?? dockerReady)()) {
    console.error("npm run test:images needs Docker, and `docker info` failed.");
    return 1;
  }
  const listed = await listByVitest(options);
  if (listed === null) return 1;
  const scratch = mkdtempSync(join(tmpdir(), "unset-test-"));
  try {
    const report: VitestJsonReport = { testResults: [] };
    let status = 0;
    for (const [i, projects] of plan.runs.entries()) {
      const result = await runVitest(options, projects, join(scratch, `vitest-${i}.json`));
      if (result === null) return 1;
      report.testResults.push(...result.report.testResults);
      if (status === 0) status = result.status;
    }
    const expected = new Set(plan.expected);
    const outcome = compare(
      glob,
      listed,
      executedFiles(root, report),
      skippedOnly(root, report),
      skippedCases(root, report),
      strayTestFiles(root),
      listed.filter((f) => expected.has(f)),
    );
    if (plan.notRun !== null) console.error(`\n${plan.notRun}`);
    if (!printOutcome(outcome)) return 1;
    if (status === 0) console.error(`\nAll ${plan.expected.length} test files this run selects ran.`);
    return status;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  const mode = modeFor(process.env, process.argv.slice(2));
  process.exit(await main({ root, config: join(root, "vitest.config.ts"), mode }));
}
