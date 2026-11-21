// The daily look at every dated waiver (P1.38p; Alex's approval 2026-11-15T20:52:18Z). A date passing is nobody's
// pull request, so the required `check` job no longer turns red on it (trivyignore.ts, `"shape"`). What still
// enforces a passed date: Trivy stops honouring the entry, so the image scan fails on the finding; the audit job
// refuses an expired npm entry. This script is the early notice: the scheduled `waivers` workflow fails when any
// entry has expired or expires within WARN_DAYS, so a renewal or a fix is decided before a scan goes red.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const WARN_DAYS = 7;
/** Every file that holds dated acceptances, from the repository root. */
export const WAIVER_FILES = [
  ".github/trivyignore.yaml",
  ".github/trivyignore.pds.yaml",
  ".github/trivyignore.seaweedfs.yaml",
  ".github/trivyignore.newt.yaml",
  ".github/trivyignore.python.yaml",
  ".github/trivyignore.app.yaml",
  ".github/npm-audit-ignore.yaml",
] as const;
const DAY_MS = 86_400_000;

/** yyyy-mm-dd as UTC midnight, or null. A YAML 1.1 timestamp parsed into a Date counts too. */
function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * One line per entry of `yamlText` that has expired on `today` or expires within `withinDays`. Every top-level list
 * is read (Trivy's sections, npm audit's `advisories`). An entry with no readable date is listed too (fail closed);
 * the shape rules that refuse it in a pull request are trivyignore.ts and npm-audit.ts.
 */
export function expiringWaivers(yamlText: string, today: Date, withinDays: number = WARN_DAYS): string[] {
  const doc: Record<string, unknown> = parse(yamlText) ?? {};
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Object.entries(doc).flatMap(([section, entries]) => {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry: { id?: unknown; expired_at?: unknown } | null, index) => {
      const name = `${section} ${typeof entry?.id === "string" ? entry.id : `entry ${index + 1}`}`;
      const expires = dateOf(entry?.expired_at);
      if (expires === null) return [`${name}: no readable expired_at`];
      const day = expires.toISOString().slice(0, 10);
      if (expires.getTime() <= startOfToday) return [`${name}: expired on ${day}`];
      const daysLeft = Math.round((expires.getTime() - startOfToday) / DAY_MS);
      return daysLeft <= withinDays ? [`${name}: expires on ${day}, in ${daysLeft} day(s)`] : [];
    });
  });
}

function main(): void {
  const root = join(import.meta.dirname, "..", "..");
  const today = new Date();
  const problems = WAIVER_FILES.flatMap((file) =>
    expiringWaivers(readFileSync(join(root, file), "utf8"), today).map((line) => `${file}: ${line}`),
  );
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`waivers: no entry expires within ${WARN_DAYS} days`);
}

if (import.meta.main) main();
