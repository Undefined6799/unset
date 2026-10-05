// Line budgets per folder (plan §4, decision 15): warnings on the PR, never a failed build.
// A budgets.json key joins folders or globs with " + "; a part starting with "!" is subtracted.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { read, sourceFiles } from "../guards/files.ts";

export type Warning = { key: string; lines: number; max: number; level: "warning" | "notice" };
/** A budget is a number, or a raised number with the one-line reason splitting would hurt readability (DC-1). */
export type Budget = number | { max: number; reason: string };

/** Plan §4's numbers. A budgets.json entry above its default needs a reason; it only warns without one. */
const PLAN_DEFAULTS: Readonly<Record<string, number>> = {
  "domains + infrastructure + !infrastructure/net-guard + !infrastructure/audit + shared/config + shared/errors + shared/i18n + shared/log + shared/http + shared/admin-envelope": 9000,
  "apps/web + interfaces/http": 7000,
  "interfaces/api": 1200,
  "interfaces/indexer": 1500,
  "interfaces/media": 600,
  "interfaces/review": 2500,
  "apps/admin + interfaces/admin + interfaces/pds-admin + infrastructure/audit": 3000,
  "infrastructure/net-guard": 400,
  "shared/ui": 2500,
};

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
export function check(root: string, budgets: Record<string, Budget>): Warning[] {
  const files = sourceFiles(root, ["."]).filter((f) => COUNTED.test(f) && !NOT_COUNTED.test(f));
  const sizes = new Map(files.map((f) => [f, countLines(read(root, f))]));
  const warnings: Warning[] = [];
  for (const [key, budget] of Object.entries(budgets)) {
    const max = maxOf(budget);
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

function maxOf(budget: Budget): number {
  const max = typeof budget === "number" ? budget : budget?.max;
  if (typeof max !== "number" || !Number.isFinite(max)) throw new Error(`not a budget: ${JSON.stringify(budget)}`);
  return max;
}

const reasonOf = (budget: Budget): string => (typeof budget === "object" ? String(budget.reason ?? "").trim() : "");

/** A raised budget with no reason: a warning naming the entry, never a failure (decision 15). */
function unexplainedRaises(budgets: Record<string, Budget>): string[] {
  return Object.entries(budgets).flatMap(([key, budget]) => {
    const plan = PLAN_DEFAULTS[key];
    const max = maxOf(budget);
    if (plan === undefined || max <= plan || reasonOf(budget)) return [];
    return [`::warning title=line-budget::${key} raised to ${max} above the plan's ${plan} without a reason`];
  });
}

/** Always returns 0: a budget is a signal for review, not a gate. */
export function main(root: string, print: (line: string) => void, summary?: string): number {
  try {
    const budgets: Record<string, Budget> = JSON.parse(
      readFileSync(join(root, "scripts/budgets/budgets.json"), "utf8"),
    );
    const raises = unexplainedRaises(budgets);
    const warnings = check(root, budgets);
    for (const line of raises) print(line);
    for (const w of warnings) {
      const reason = reasonOf(budgets[w.key] ?? 0);
      print(`::${w.level} title=line-budget::${w.key} ${w.lines}/${w.max}${reason ? ` (raised: ${reason})` : ""}`);
    }
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
