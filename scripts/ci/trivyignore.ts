// The Trivy ignore file's own rules (P1.27q; threat "a known-vulnerable image ships under a stale ignore"). Every
// entry names its finding (`id`), says why it is accepted (`statement`) and stops applying within MAX_DAYS
// (`expired_at`). The field and section names are Trivy's own: Trivy v0.74.0 docs/guide/configuration/filtering.md,
// ".trivyignore.yaml" (sections vulnerabilities, misconfigurations, secrets, licenses; `expired_at` as yyyy-mm-dd).
// Trivy stops honouring an expired entry, so the image scan that reads the file fails on the finding again. The
// required `check` job judges only what a pull request can change (`"shape"`: id, reason, a date at most maxDays
// ahead); a date passing is not a pull request's doing, so the daily waivers workflow reports it, a week ahead
// (waiver-expiry.ts, P1.38p; Alex's approval 2026-11-15T20:52:18Z).
import { parse } from "yaml";

export const MAX_DAYS = 90;
/** P1.33c: the PDS file expires within 30 days. The shared file stays at MAX_DAYS. */
export const PDS_MAX_DAYS = 30;
/** P2.18s: the SeaweedFS file expires within 30 days too (Alex's "yes waiver", 2026-11-15T23:08:12Z). */
export const SEAWEEDFS_MAX_DAYS = 30;
/** P1.37m: the Newt file expires within 30 days too. */
export const NEWT_MAX_DAYS = 30;
/** P6.02: the Python base's file expires within 30 days too. */
export const PYTHON_MAX_DAYS = 30;
const SECTIONS = ["vulnerabilities", "misconfigurations", "secrets", "licenses"] as const;
const DAY_MS = 86_400_000;

type Entry = { id?: unknown; statement?: unknown; expired_at?: unknown };
/** `"all"` also fails an entry whose date has passed; `"shape"` leaves that to the scan and the daily job. */
export type WaiverCheck = "all" | "shape";

/** yyyy-mm-dd as UTC midnight, or null. A YAML 1.1 timestamp parsed into a Date counts too. */
function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function entryProblems(
  section: string,
  entry: Entry,
  index: number,
  today: Date,
  maxDays: number,
  check: WaiverCheck,
): string[] {
  const name = typeof entry.id === "string" && entry.id !== "" ? `${section} ${entry.id}` : null;
  if (name === null) return [`${section} entry ${index + 1}: no id`];
  if (typeof entry.statement !== "string" || entry.statement.trim() === "")
    return [`${name}: no statement (the reason)`];
  const expires = dateOf(entry.expired_at);
  if (expires === null) return [`${name}: no expired_at`];
  const day = expires.toISOString().slice(0, 10);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (expires.getTime() <= startOfToday) return check === "all" ? [`${name}: expired on ${day}`] : [];
  if (expires.getTime() > startOfToday + maxDays * DAY_MS)
    return [`${name}: expired_at ${day} is more than ${maxDays} days ahead`];
  return [];
}

/** Every rule the ignore file breaks on `today`; an empty list means it may be used. */
export function trivyIgnoreProblems(
  yamlText: string,
  today: Date,
  maxDays: number = MAX_DAYS,
  check: WaiverCheck = "all",
): string[] {
  const doc: Record<string, unknown> = parse(yamlText) ?? {};
  return Object.entries(doc).flatMap(([section, entries]) => {
    if (!(SECTIONS as readonly string[]).includes(section)) return [`unknown section ${section}`];
    if (entries === null) return [];
    if (!Array.isArray(entries)) return [`${section}: not a list`];
    return entries.flatMap((entry: Entry, i) => entryProblems(section, entry ?? {}, i, today, maxDays, check));
  });
}
