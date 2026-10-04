// Test runner wrapper: discovers every *.test.ts file, runs exactly that list
// with node:test, and fails unless every discovered file reported at least one
// real test result (a file that defines no tests, or fails to load, counts as missing).
// In the prototype 20 of 47 UI test files silently never ran (PLAN.md §2 rule 27).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceFiles } from "./files.ts";

export const TEST_DIRS = ["apps", "interfaces", "domains", "infrastructure", "shared", "scripts"] as const;
const TEST_FILE = /\.test\.ts$/;

export function discoverTests(root: string): string[] {
  return sourceFiles(root, TEST_DIRS).filter((f) => TEST_FILE.test(f));
}

/** Discovered files that never reported a result (absolute paths in `reported`). */
export function missingFiles(root: string, discovered: string[], reported: string[]): string[] {
  const seen = new Set(reported.map((p) => relative(root, p).split(sep).join("/")));
  return discovered.filter((f) => !seen.has(f));
}

export function main(root = process.cwd()): number {
  const files = discoverTests(root);
  if (files.length === 0) {
    console.error("No test files discovered.");
    return 1;
  }
  const scratch = mkdtempSync(join(tmpdir(), "run-tests-"));
  const ledger = join(scratch, "files.txt");
  try {
    const run = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        `--test-reporter=${pathToFileURL(join(import.meta.dirname, "file-reporter.ts")).href}`,
        `--test-reporter-destination=${ledger}`,
        ...files,
      ],
      { cwd: root, stdio: "inherit" },
    );
    const reported = readFileSync(ledger, "utf8").split("\n").filter(Boolean);
    const missing = missingFiles(root, files, reported);
    if (missing.length > 0) {
      console.error(`\n${missing.length} of ${files.length} discovered test files reported no results:`);
      for (const f of missing) console.error(`  ${f}`);
      return 1;
    }
    console.error(`\nAll ${files.length} discovered test files ran.`);
    return run.status ?? 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
