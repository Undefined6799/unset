// The Trivy ignore file's own rules (P1.27q; threat "a known-vulnerable image ships under a stale ignore"). Every
// entry names its finding (`id`), says why it is accepted (`statement`) and stops applying within MAX_DAYS
// (`expired_at`). The field and section names are Trivy's own: Trivy v0.74.0 docs/guide/configuration/filtering.md,
// ".trivyignore.yaml" (sections vulnerabilities, misconfigurations, secrets, licenses; `expired_at` as yyyy-mm-dd).
// Trivy alone would quietly stop honouring an expired entry; this check turns it into a red build so someone decides.
import { parse } from "yaml";

export const MAX_DAYS = 90;
const SECTIONS = ["vulnerabilities", "misconfigurations", "secrets", "licenses"] as const;
const DAY_MS = 86_400_000;

type Entry = { id?: unknown; statement?: unknown; expired_at?: unknown };

/** yyyy-mm-dd as UTC midnight, or null. A YAML 1.1 timestamp parsed into a Date counts too. */
function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function entryProblems(section: string, entry: Entry, index: number, today: Date): string[] {
  const name = typeof entry.id === "string" && entry.id !== "" ? `${section} ${entry.id}` : null;
  if (name === null) return [`${section} entry ${index + 1}: no id`];
  if (typeof entry.statement !== "string" || entry.statement.trim() === "")
    return [`${name}: no statement (the reason)`];
  const expires = dateOf(entry.expired_at);
  if (expires === null) return [`${name}: no expired_at`];
  const day = expires.toISOString().slice(0, 10);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (expires.getTime() <= startOfToday) return [`${name}: expired on ${day}`];
  if (expires.getTime() > startOfToday + MAX_DAYS * DAY_MS)
    return [`${name}: expired_at ${day} is more than ${MAX_DAYS} days ahead`];
  return [];
}

/** Every rule the ignore file breaks on `today`; an empty list means it may be used. */
export function trivyIgnoreProblems(yamlText: string, today: Date): string[] {
  const doc: Record<string, unknown> = parse(yamlText) ?? {};
  return Object.entries(doc).flatMap(([section, entries]) => {
    if (!(SECTIONS as readonly string[]).includes(section)) return [`unknown section ${section}`];
    if (entries === null) return [];
    if (!Array.isArray(entries)) return [`${section}: not a list`];
    return entries.flatMap((entry: Entry, i) => entryProblems(section, entry ?? {}, i, today));
  });
}
