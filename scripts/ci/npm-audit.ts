// The npm audit gate with an accepted-findings file (P0.07i; threat "a known-vulnerable package ships under a stale
// acceptance"). npm has no ignore option, so this replaces `npm audit --audit-level=high`: it reads
// `npm audit --json` (auditReportVersion 2, npm 11.20.0 lib/commands/audit.js) and fails on every high or critical
// advisory that .github/npm-audit-ignore.yaml does not accept. An entry names the advisory (`id`, the GHSA id at the
// end of its url), the `package`, the exact `versions` it covers (every installed copy must be one of them, so a
// lockfile change re-opens the question), why it is accepted (`statement`) and `expired_at`, at most MAX_DAYS ahead,
// as in .github/trivyignore.yaml. An entry nothing matches any more is a failure too, so it is removed, not kept.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const MAX_DAYS = 30;
const FAILING = new Set(["high", "critical"]);
const DAY_MS = 86_400_000;

type Advisory = { name: string; url: string; severity: string; title: string };
type Vulnerability = { via: (string | Advisory)[]; nodes: string[] };
export type AuditReport = { auditReportVersion?: number; vulnerabilities?: Record<string, Vulnerability> };
type Entry = { id?: unknown; package?: unknown; versions?: unknown; statement?: unknown; expired_at?: unknown };
/** Lockfile path (node_modules/...) to installed version. */
export type Installed = Readonly<Record<string, string | undefined>>;

const idOf = (advisory: Advisory): string => advisory.url.slice(advisory.url.lastIndexOf("/") + 1);

/** yyyy-mm-dd as UTC midnight, or null. A YAML 1.1 timestamp parsed into a Date counts too. */
function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function entryProblem(entry: Entry, index: number, today: Date): string | null {
  if (typeof entry.id !== "string" || !/^GHSA(-[0-9a-z]{4}){3}$/.test(entry.id))
    return `entry ${index + 1}: no GHSA id`;
  if (typeof entry.package !== "string" || entry.package === "") return `${entry.id}: no package`;
  const versions = entry.versions;
  if (!Array.isArray(versions) || versions.length === 0 || !versions.every((v) => typeof v === "string"))
    return `${entry.id}: no exact versions`;
  if (typeof entry.statement !== "string" || entry.statement.trim() === "") return `${entry.id}: no statement`;
  const expires = dateOf(entry.expired_at);
  if (expires === null) return `${entry.id}: no expired_at`;
  const day = expires.toISOString().slice(0, 10);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (expires.getTime() <= startOfToday) return `${entry.id}: expired on ${day}`;
  if (expires.getTime() > startOfToday + MAX_DAYS * DAY_MS)
    return `${entry.id}: expired_at ${day} is more than ${MAX_DAYS} days ahead`;
  return null;
}

/** Why `advisory` still fails the gate under `entry`, or null when the entry accepts it. */
function unaccepted(
  advisory: Advisory,
  entry: Entry | undefined,
  nodes: string[],
  installed: Installed,
): string | null {
  const name = `${idOf(advisory)} (${advisory.name}, ${advisory.severity}): ${advisory.title}`;
  if (entry === undefined) return name;
  if (entry.package !== advisory.name) return `${name}: accepted for package ${String(entry.package)} only`;
  const versions = entry.versions as string[];
  const other = nodes.map((node) => installed[node] ?? `unknown at ${node}`).find((v) => !versions.includes(v));
  return other === undefined ? null : `${name}: version ${other} is not accepted`;
}

/** Every reason the audit fails on `today`; an empty list means it passes. */
export function auditProblems(report: AuditReport, ignoreYaml: string, installed: Installed, today: Date): string[] {
  if (report.auditReportVersion !== 2) return ["npm audit --json: not auditReportVersion 2"];
  const listed: unknown = (parse(ignoreYaml) ?? {}).advisories ?? [];
  if (!Array.isArray(listed)) return ["advisories: not a list"];
  const entries = listed as Entry[];
  const problems = entries.flatMap((entry, i) => entryProblem(entry ?? {}, i, today) ?? []);
  if (problems.length > 0) return problems;
  const used = new Set<string>();
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const advisory of vulnerability.via) {
      if (typeof advisory === "string" || !FAILING.has(advisory.severity)) continue;
      const entry = entries.find((e) => e.id === idOf(advisory));
      if (entry !== undefined) used.add(entry.id as string);
      const problem = unaccepted({ ...advisory, name }, entry, vulnerability.nodes, installed);
      if (problem !== null) problems.push(problem);
    }
  }
  for (const entry of entries)
    if (!used.has(entry.id as string)) problems.push(`${entry.id}: matches nothing, remove it`);
  return problems;
}

function main(): void {
  const root = join(import.meta.dirname, "..", "..");
  let stdout: string;
  try {
    stdout = execFileSync("npm", ["audit", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits 1 when it finds anything; the report is still on stdout.
    stdout = String((error as { stdout?: unknown }).stdout ?? "");
  }
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  const installed = Object.fromEntries(Object.entries(lock.packages).map(([path, p]) => [path, p.version]));
  const ignore = readFileSync(join(root, ".github", "npm-audit-ignore.yaml"), "utf8");
  const problems = auditProblems(JSON.parse(stdout) as AuditReport, ignore, installed, new Date());
  for (const problem of problems) console.error(`npm audit: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log("npm audit: no unaccepted high or critical advisory");
}

if (import.meta.main) main();
