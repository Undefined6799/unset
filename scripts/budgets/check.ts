// Line budgets per folder (plan §4, decision 15): warnings on the PR, never a failed build.
// A budgets.json key joins folders or globs with " + "; a part starting with "!" is subtracted.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { read, sourceFiles } from "../guards/files.ts";

export type Warning = { key: string; lines: number; max: number; level: "warning" | "notice" };

const COUNTED = /\.(ts|tsx)$/;
// Tests, fakes (test doubles; architecture ruling 2026-10-04 23:53Z) and generated code are not module code.
const NOT_COUNTED = /\.(test|generated)\.[^/]+$|\.fake\.ts$/;
const NOTICE_SHARE = 0.9;

/** Non-blank lines that are not only a comment. Approximate: a comment opened after code, or "/*" inside a
 * template string, is not tracked. Good enough for a warning, which is all a budget is. */
export function countLines(source: string): number {
  let count = 0;
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      inBlock = false;
      line = line.slice(end + 2).trim();
    }
    while (line.startsWith("/*")) {
      const end = line.indexOf("*/", 2);
      if (end === -1) {
        inBlock = true;
        line = "";
      } else {
        line = line.slice(end + 2).trim();
      }
    }
    if (line !== "" && !line.startsWith("//")) count++;
  }
  return count;
}

/** "apps/web" covers the folder; anything with a glob character is used as written. */
function toGlob(part: string): string {
  return /[*?[{]/.test(part) ? part : `${part.replace(/\/$/, "")}/**`;
}

function inKey(file: string, key: string): boolean {
  const parts = key.split(" + ").map((p) => p.trim());
  const include = parts.filter((p) => !p.startsWith("!")).map(toGlob);
  const exclude = parts.filter((p) => p.startsWith("!")).map((p) => toGlob(p.slice(1)));
  return include.some((g) => matchesGlob(file, g)) && !exclude.some((g) => matchesGlob(file, g));
}

/** A budget whose folders do not exist yet counts 0 (packages appear in P1.01). */
export function check(root: string, budgets: Record<string, number>): Warning[] {
  const files = sourceFiles(root, ["."]).filter((f) => COUNTED.test(f) && !NOT_COUNTED.test(f));
  const sizes = new Map(files.map((f) => [f, countLines(read(root, f))]));
  const warnings: Warning[] = [];
  for (const [key, max] of Object.entries(budgets)) {
    let lines = 0;
    for (const [file, n] of sizes) if (inKey(file, key)) lines += n;
    if (lines > max) warnings.push({ key, lines, max, level: "warning" });
    else if (lines > NOTICE_SHARE * max) warnings.push({ key, lines, max, level: "notice" });
  }
  return warnings;
}

function summaryTable(warnings: Warning[]): string {
  const rows = warnings.map((w) => `| ${w.key} | ${w.lines} | ${w.max} | ${w.level} |`);
  return ["### Line budgets", "", "| Budget | Lines | Max | Level |", "| --- | --- | --- | --- |", ...rows, ""].join(
    "\n",
  );
}

function writeSummary(path: string, table: string, print: (line: string) => void): void {
  try {
    appendFileSync(path, table);
  } catch (error) {
    print(`::warning title=line-budget::step summary not written: ${String(error)}`);
  }
}

/** Always returns 0: a budget is a signal for review, not a gate. */
export function main(root: string, print: (line: string) => void, summary?: string): number {
  try {
    const budgets: Record<string, number> = JSON.parse(
      readFileSync(join(root, "scripts/budgets/budgets.json"), "utf8"),
    );
    const warnings = check(root, budgets);
    for (const w of warnings) print(`::${w.level} title=line-budget::${w.key} ${w.lines}/${w.max}`);
    if (warnings.length === 0) print("All line budgets within 90%.");
    if (summary && warnings.length > 0) writeSummary(summary, summaryTable(warnings), print);
  } catch (error) {
    print(`::warning title=line-budget::budget check could not run: ${String(error)}`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  process.exitCode = main(root, console.log, process.env.GITHUB_STEP_SUMMARY);
}
