// The fixed triage comment form from docs/human/severity.md (P0.09b). The launch gate (L.02) reuses this parser,
// so a comment it accepts here is a comment the gate accepts.

export type Severity = "sev-1" | "sev-2" | "sev-3";
export type Decision = "fix" | "accept-for-launch" | "upstream-mitigated";
export type Triage = {
  severity: Severity;
  matches: string;
  decision: Decision;
  mitigationTest?: string;
  /** The day Alex confirmed, YYYY-MM-DD. */
  confirmedBy?: string;
};
export type TriageResult = { ok: true; triage: Triage } | { ok: false; problems: string[] };

/** The fields in their fixed order; the last two are optional. */
const FIELDS = ["Triage", "Matches", "Decision", "Mitigation test", "Confirmed-by"] as const;
type Field = (typeof FIELDS)[number];
const REQUIRED: readonly Field[] = ["Triage", "Matches", "Decision"];
const SEVERITIES: readonly string[] = ["sev-1", "sev-2", "sev-3"];
const DECISIONS: readonly string[] = ["fix", "accept-for-launch", "upstream-mitigated"];

/** "Alex YYYY-MM-DD" with a date that exists; returns the date or undefined. */
function confirmationDate(value: string): string | undefined {
  const date = /^Alex (\d{4}-\d{2}-\d{2})$/.exec(value)?.[1];
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : undefined;
}

/** Reads "Field: value" lines in the fixed order; each field at most once. */
function readFields(text: string, problems: string[]): Map<Field, string> {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  const values = new Map<Field, string>();
  let next = 0;
  for (const [index, line] of lines.entries()) {
    const at = `line ${index + 1}`;
    const colon = line.indexOf(":");
    const name = colon === -1 ? line.trim() : line.slice(0, colon);
    const position = FIELDS.indexOf(name as Field);
    const skipped = FIELDS.slice(next, position).find((f) => REQUIRED.includes(f));
    // An order error makes every later line ambiguous, so reading stops at the first one.
    if (position === -1 || position < next) {
      problems.push(`${at}: unexpected ${name}`);
      break;
    }
    if (skipped) {
      problems.push(`${at}: expected ${skipped}, found ${name}`);
      break;
    }
    next = position + 1;
    const value = line.slice(colon + 1).trim();
    if (value === "") problems.push(`${at}: ${name} is empty`);
    values.set(name as Field, value);
  }
  return values;
}

/** Rules on each value: the allowed words, and the mitigation test only on a downgrade. */
function valueProblems(values: ReadonlyMap<Field, string>): string[] {
  const problems = REQUIRED.filter((field) => !values.has(field)).map((field) => `missing ${field}`);
  const severity = values.get("Triage");
  const decision = values.get("Decision");
  if (severity !== undefined && !SEVERITIES.includes(severity)) problems.push("Triage must be sev-1, sev-2 or sev-3");
  if (decision && !DECISIONS.includes(decision)) {
    problems.push("Decision must be fix, accept-for-launch or upstream-mitigated");
  }
  const downgrade = decision === "upstream-mitigated";
  const hasTest = values.has("Mitigation test");
  if (downgrade && !hasTest) problems.push("a downgrade needs Mitigation test");
  if (!downgrade && hasTest) problems.push("Mitigation test is only for a downgrade");
  return problems;
}

/** Alex confirms every sev-1, every sev-2 and every downgrade; a confirmation names a real day. */
function confirmationProblems(values: ReadonlyMap<Field, string>): string[] {
  const severity = values.get("Triage");
  const confirmed = values.get("Confirmed-by");
  if (confirmed !== undefined) {
    return confirmationDate(confirmed) ? [] : ["Confirmed-by must be Alex YYYY-MM-DD"];
  }
  if (severity === "sev-1" || severity === "sev-2") return [`${severity} needs Confirmed-by: Alex YYYY-MM-DD`];
  if (values.get("Decision") === "upstream-mitigated") return ["a downgrade needs Confirmed-by: Alex YYYY-MM-DD"];
  return [];
}

/** Parses one triage comment. Every problem is reported, so a reviewer sees them all at once. */
export function parseTriage(text: string): TriageResult {
  const problems: string[] = [];
  const values = readFields(text, problems);
  if (problems.some((p) => / (expected|unexpected) /.test(p))) return { ok: false, problems };
  problems.push(...valueProblems(values), ...confirmationProblems(values));
  if (problems.length > 0) return { ok: false, problems };

  const triage: Triage = {
    severity: values.get("Triage") as Severity,
    matches: values.get("Matches") as string,
    decision: values.get("Decision") as Decision,
  };
  const mitigationTest = values.get("Mitigation test");
  const confirmed = values.get("Confirmed-by");
  if (mitigationTest !== undefined) triage.mitigationTest = mitigationTest;
  if (confirmed !== undefined) triage.confirmedBy = confirmationDate(confirmed) as string;
  return { ok: true, triage };
}
